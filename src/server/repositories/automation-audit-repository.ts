/**
 * Repository layer for the cross-cutting Automation Audit Trail — one
 * row per automated action, answering who/what-rule/why/what-changed/
 * what-journals/what-documents/how-long/reversible for EVERY module's
 * automated activity, not a per-module history table.
 */

import { createClient } from "@/lib/supabase/server";
import { auditLogEntryFromRow, type AutomationAuditLogRow } from "@/server/automation/mappers";
import type { AutomationAuditLogEntry } from "@/server/automation/types";

export type NewAuditLogEntry = {
  performedBy?: string;
  actionType: string;
  ruleId?: number | null;
  reason?: string;
  changes?: Record<string, unknown>;
  journalIds?: number[];
  documentType?: string | null;
  documentId?: number | null;
  durationMs?: number | null;
  isReversible?: boolean;
};

/** RC1 Phase 7 — writes only through `record_automation_audit_entry()`,
 * a `security definer` RPC (see 0031_security_certification_hardening.sql).
 * A direct client INSERT policy no longer exists on this table — a
 * security audit found the previous "for all" policy let any company
 * member directly edit/delete their own audit trail, undermining the
 * integrity guarantee an audit log implies. */
export async function recordAuditEntry(companyId: string, input: NewAuditLogEntry): Promise<AutomationAuditLogEntry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("record_automation_audit_entry", {
      target_company_id: companyId,
      p_performed_by: input.performedBy ?? "System",
      p_action_type: input.actionType,
      p_rule_id: input.ruleId ?? null,
      p_reason: input.reason ?? "",
      p_changes: input.changes ?? {},
      p_journal_ids: input.journalIds ?? [],
      p_document_type: input.documentType ?? null,
      p_document_id: input.documentId ?? null,
      p_duration_ms: input.durationMs ?? null,
      p_is_reversible: input.isReversible ?? false,
    })
    .single<AutomationAuditLogRow>();
  if (error) throw error;
  return auditLogEntryFromRow(data);
}

export async function listAuditLog(companyId: string, limit = 100): Promise<AutomationAuditLogEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_audit_log")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AutomationAuditLogRow[]>();
  if (error) throw error;
  return data.map(auditLogEntryFromRow);
}

export async function listAuditLogForDocument(companyId: string, documentType: string, documentId: number): Promise<AutomationAuditLogEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_audit_log")
    .select("*")
    .eq("company_id", companyId)
    .eq("document_type", documentType)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(10_000)
    .returns<AutomationAuditLogRow[]>();
  if (error) throw error;
  return data.map(auditLogEntryFromRow);
}
