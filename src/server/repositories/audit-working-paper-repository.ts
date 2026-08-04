/**
 * Repository layer for generated Audit Working Papers. See
 * supabase/migrations/0017_auditor_workspace.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { auditWorkingPaperFromRow, type AuditWorkingPaperRow } from "@/server/audit/mappers";
import type { AuditWorkingPaper, AuditWorkingPaperType } from "@/server/audit/types";

export async function listAuditWorkingPapers(companyId: string, engagementId?: number): Promise<AuditWorkingPaper[]> {
  const supabase = await createClient();
  let query = supabase.from("audit_working_papers").select("*").eq("company_id", companyId);
  if (engagementId) query = query.eq("engagement_id", engagementId);
  const { data, error } = await query.order("generated_at", { ascending: false }).returns<AuditWorkingPaperRow[]>();
  if (error) throw error;
  return data.map(auditWorkingPaperFromRow);
}

export type NewAuditWorkingPaper = {
  engagementId?: number | null;
  paperType: AuditWorkingPaperType;
  title: string;
  content: Record<string, unknown>;
  generatedBy?: string;
};

export async function createAuditWorkingPaper(companyId: string, input: NewAuditWorkingPaper): Promise<AuditWorkingPaper> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_working_papers")
    .insert({
      company_id: companyId,
      engagement_id: input.engagementId ?? null,
      paper_type: input.paperType,
      title: input.title,
      content: input.content,
      generated_by: input.generatedBy ?? "System",
    })
    .select("*")
    .single<AuditWorkingPaperRow>();
  if (error) throw error;
  return auditWorkingPaperFromRow(data);
}
