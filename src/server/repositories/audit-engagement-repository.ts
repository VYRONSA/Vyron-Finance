/**
 * Repository layer for Audit Engagements — the top-level Audit Planning
 * object (Financial Year, Materiality, Performance Materiality, Status,
 * Team). See supabase/migrations/0017_auditor_workspace.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { auditEngagementFromRow, type AuditEngagementRow } from "@/server/audit/mappers";
import type { AuditEngagement, AuditEngagementStatus } from "@/server/audit/types";

export async function listAuditEngagements(companyId: string): Promise<AuditEngagement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_engagements")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .returns<AuditEngagementRow[]>();
  if (error) throw error;
  return data.map(auditEngagementFromRow);
}

export async function getAuditEngagement(companyId: string, engagementId: number): Promise<AuditEngagement | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_engagements")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", engagementId)
    .maybeSingle<AuditEngagementRow>();
  if (error) throw error;
  return data ? auditEngagementFromRow(data) : null;
}

export type NewAuditEngagement = {
  financialYearId?: number | null;
  name: string;
  materiality?: number;
  performanceMateriality?: number;
  leadAuditor?: string;
  createdBy?: string;
};

export async function createAuditEngagement(companyId: string, input: NewAuditEngagement): Promise<AuditEngagement> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_engagements")
    .insert({
      company_id: companyId,
      financial_year_id: input.financialYearId ?? null,
      name: input.name,
      materiality: input.materiality ?? 0,
      performance_materiality: input.performanceMateriality ?? 0,
      lead_auditor: input.leadAuditor ?? "",
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<AuditEngagementRow>();
  if (error) throw error;
  return auditEngagementFromRow(data);
}

export type UpdatableAuditEngagementFields = Partial<{
  name: string;
  materiality: number;
  performance_materiality: number;
  status: AuditEngagementStatus;
  lead_auditor: string;
  planning_notes: string;
}>;

export async function updateAuditEngagement(companyId: string, engagementId: number, fields: UpdatableAuditEngagementFields): Promise<AuditEngagement> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_engagements")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", engagementId)
    .select("*")
    .single<AuditEngagementRow>();
  if (error) throw error;
  return auditEngagementFromRow(data);
}
