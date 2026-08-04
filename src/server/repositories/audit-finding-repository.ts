/**
 * Repository layer for Audit Findings — both Audit Test results and
 * Audit Intelligence indicators, distinguished by `category`. Same
 * idempotent-raise pattern as `executive-alert-repository.ts` (an
 * explicit existence check before insert, not a unique-constraint catch)
 * since `related_type`/`related_id` can legitimately be null (e.g.
 * Benford Analysis is a company-wide finding, not tied to one
 * transaction) and Postgres treats null as distinct in a unique index —
 * the same gap `executive_alerts` has, closed the same way.
 */

import { createClient } from "@/lib/supabase/server";
import { auditFindingFromRow, type AuditFindingRow } from "@/server/audit/mappers";
import type { AuditFinding, AuditFindingCategory, AuditFindingSeverity, AuditFindingType } from "@/server/audit/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listAuditFindings(companyId: string, filters: { category?: AuditFindingCategory; status?: AuditFinding["status"]; engagementId?: number } = {}): Promise<AuditFinding[]> {
  const supabase = await createClient();
  let query = supabase.from("audit_findings").select("*").eq("company_id", companyId);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.engagementId) query = query.eq("engagement_id", filters.engagementId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_CAP).returns<AuditFindingRow[]>();
  if (error) throw error;
  return data.map(auditFindingFromRow);
}

export type NewAuditFinding = {
  engagementId?: number | null;
  findingType: AuditFindingType;
  category: AuditFindingCategory;
  severity: AuditFindingSeverity;
  confidence: number;
  reason: string;
  evidence: string;
  suggestedProcedure: string;
  relatedType?: string | null;
  relatedId?: number | null;
};

export async function raiseFindingIdempotent(companyId: string, input: NewAuditFinding): Promise<{ finding: AuditFinding; created: boolean }> {
  const supabase = await createClient();

  let existingQuery = supabase.from("audit_findings").select("*").eq("company_id", companyId).eq("finding_type", input.findingType).eq("status", "Open");
  existingQuery = input.relatedType ? existingQuery.eq("related_type", input.relatedType) : existingQuery.is("related_type", null);
  existingQuery = input.relatedId != null ? existingQuery.eq("related_id", input.relatedId) : existingQuery.is("related_id", null);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle<AuditFindingRow>();
  if (existingError) throw existingError;
  if (existing) return { finding: auditFindingFromRow(existing), created: false };

  const { data, error } = await supabase
    .from("audit_findings")
    .insert({
      company_id: companyId,
      engagement_id: input.engagementId ?? null,
      finding_type: input.findingType,
      category: input.category,
      severity: input.severity,
      confidence: input.confidence,
      reason: input.reason,
      evidence: input.evidence,
      suggested_procedure: input.suggestedProcedure,
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    })
    .select("*")
    .single<AuditFindingRow>();
  if (error) throw error;
  return { finding: auditFindingFromRow(data), created: true };
}

export async function reviewFinding(companyId: string, findingId: number, status: "Reviewed" | "Dismissed", reviewedBy: string, note: string): Promise<AuditFinding> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_findings")
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString(), review_note: note })
    .eq("company_id", companyId)
    .eq("id", findingId)
    .select("*")
    .single<AuditFindingRow>();
  if (error) throw error;
  return auditFindingFromRow(data);
}
