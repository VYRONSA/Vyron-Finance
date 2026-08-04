/**
 * Repository layer for Executive Alerts. Same rich shape as Banking/VAT
 * Exceptions — see supabase/migrations/0016_financial_reporting_platform.sql's
 * header comment for why this table exists alongside `notifications`
 * rather than replacing it.
 *
 * `raiseAlertIdempotent` exists because the table's own unique constraint
 * (`company_id, alert_type, related_type, related_id, status`) does NOT
 * dedupe company-wide alerts (`related_type`/`related_id` both null) —
 * Postgres treats NULLs as distinct in a unique index. This function is
 * the one place that gap is closed, via an explicit existence check
 * before insert (mirroring `vat-exception-repository.ts`'s
 * `raiseVatExceptionIdempotent`), so every caller gets idempotency
 * whether or not the alert is document-scoped.
 */

import { createClient } from "@/lib/supabase/server";
import { executiveAlertFromRow, type ExecutiveAlertRow } from "@/server/reporting/mappers";
import type { ExecutiveAlert, ExecutiveAlertPriority, ExecutiveAlertType } from "@/server/reporting/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listExecutiveAlerts(companyId: string, status?: ExecutiveAlert["status"]): Promise<ExecutiveAlert[]> {
  const supabase = await createClient();
  let query = supabase.from("executive_alerts").select("*").eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_CAP).returns<ExecutiveAlertRow[]>();
  if (error) throw error;
  return data.map(executiveAlertFromRow);
}

export type NewExecutiveAlert = {
  alertType: ExecutiveAlertType;
  priority: ExecutiveAlertPriority;
  reason: string;
  evidence: string;
  recommendedAction: string;
  relatedType?: string | null;
  relatedId?: number | null;
};

export async function raiseAlertIdempotent(companyId: string, input: NewExecutiveAlert): Promise<{ alert: ExecutiveAlert; created: boolean }> {
  const supabase = await createClient();

  let existingQuery = supabase
    .from("executive_alerts")
    .select("*")
    .eq("company_id", companyId)
    .eq("alert_type", input.alertType)
    .eq("status", "Open");
  existingQuery = input.relatedType ? existingQuery.eq("related_type", input.relatedType) : existingQuery.is("related_type", null);
  existingQuery = input.relatedId != null ? existingQuery.eq("related_id", input.relatedId) : existingQuery.is("related_id", null);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle<ExecutiveAlertRow>();
  if (existingError) throw existingError;
  if (existing) return { alert: executiveAlertFromRow(existing), created: false };

  const { data, error } = await supabase
    .from("executive_alerts")
    .insert({
      company_id: companyId,
      alert_type: input.alertType,
      priority: input.priority,
      reason: input.reason,
      evidence: input.evidence,
      recommended_action: input.recommendedAction,
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    })
    .select("*")
    .single<ExecutiveAlertRow>();
  if (error) throw error;
  return { alert: executiveAlertFromRow(data), created: true };
}

export async function resolveAlert(companyId: string, alertId: number, resolvedBy: string, note: string): Promise<ExecutiveAlert> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("executive_alerts")
    .update({ status: "Resolved", resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("company_id", companyId)
    .eq("id", alertId)
    .select("*")
    .single<ExecutiveAlertRow>();
  if (error) throw error;
  return executiveAlertFromRow(data);
}

export async function dismissAlert(companyId: string, alertId: number, resolvedBy: string, note: string): Promise<ExecutiveAlert> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("executive_alerts")
    .update({ status: "Dismissed", resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("company_id", companyId)
    .eq("id", alertId)
    .select("*")
    .single<ExecutiveAlertRow>();
  if (error) throw error;
  return executiveAlertFromRow(data);
}
