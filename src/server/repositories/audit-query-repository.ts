/**
 * Repository layer for reusable Auditor Queries. See
 * supabase/migrations/0017_auditor_workspace.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { auditQueryFromRow, type AuditQueryRow } from "@/server/audit/mappers";
import type { AuditQuery, AuditQueryDefinition } from "@/server/audit/types";

export async function listAuditQueries(companyId: string): Promise<AuditQuery[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("audit_queries").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).returns<AuditQueryRow[]>();
  if (error) throw error;
  return data.map(auditQueryFromRow);
}

export type NewAuditQuery = { name: string; description?: string; queryDefinition: AuditQueryDefinition; createdBy?: string };

export async function createAuditQuery(companyId: string, input: NewAuditQuery): Promise<AuditQuery> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_queries")
    .insert({ company_id: companyId, name: input.name, description: input.description ?? "", query_definition: input.queryDefinition, created_by: input.createdBy ?? "System" })
    .select("*")
    .single<AuditQueryRow>();
  if (error) throw error;
  return auditQueryFromRow(data);
}

export async function deleteAuditQuery(companyId: string, queryId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_queries").delete().eq("company_id", companyId).eq("id", queryId);
  if (error) throw error;
}
