/**
 * Repository layer for the RC1 Phase 6 Operations Centre's own two new
 * tables (`system_events`, `operations_alerts`). Every other signal the
 * Operations Centre displays reads through each engine's OWN existing
 * repository — see `operations-service.ts` for the orchestration.
 */

import { createClient } from "@/lib/supabase/server";
import { operationsAlertFromRow, systemEventFromRow, type OperationsAlertRow, type SystemEventRow } from "@/server/operations/mappers";
import type { AlertStatus, EventSeverity, OperationsAlert, SystemEvent, SystemEventType } from "@/server/operations/types";

export async function listRecentSystemEvents(companyId: string, limit = 100): Promise<SystemEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("system_events")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<SystemEventRow[]>();
  if (error) throw error;
  return data.map(systemEventFromRow);
}

export type NewSystemEvent = { companyId: string | null; eventType: SystemEventType; severity?: EventSeverity; actor?: string | null; detail?: string; metadata?: Record<string, unknown> };

export async function recordSystemEvent(input: NewSystemEvent): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("system_events").insert({
    company_id: input.companyId,
    event_type: input.eventType,
    severity: input.severity ?? "warning",
    actor: input.actor ?? null,
    detail: input.detail ?? "",
    metadata: input.metadata ?? {},
  });
  if (error) throw error;
}

export async function listAlerts(companyId: string, status?: AlertStatus): Promise<OperationsAlert[]> {
  const supabase = await createClient();
  let query = supabase.from("operations_alerts").select("*").eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).returns<OperationsAlertRow[]>();
  if (error) throw error;
  return data.map(operationsAlertFromRow);
}

export type NewOperationsAlert = { companyId: string | null; sourceEngine: string; severity: EventSeverity; title: string; message?: string; relatedNotificationId?: number | null; createdBy?: string };

export async function createAlert(input: NewOperationsAlert): Promise<OperationsAlert> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operations_alerts")
    .insert({
      company_id: input.companyId,
      source_engine: input.sourceEngine,
      severity: input.severity,
      title: input.title,
      message: input.message ?? "",
      related_notification_id: input.relatedNotificationId ?? null,
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<OperationsAlertRow>();
  if (error) throw error;
  return operationsAlertFromRow(data);
}

export type DeduplicatedAlert = { alertId: number; created: boolean; occurrenceCount: number };

/** Migration 0099 — raises an alert, or, while an unresolved alert with
 * the same `dedupeKey` exists for the company, bumps that alert's
 * occurrence count instead of adding another row. */
export async function raiseDeduplicatedAlert(input: {
  companyId: string;
  dedupeKey: string;
  sourceEngine: string;
  severity: EventSeverity;
  title: string;
  message?: string;
  nowIso?: string;
}): Promise<DeduplicatedAlert> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_raise_deduplicated_alert", {
    p_company_id: input.companyId,
    p_dedupe_key: input.dedupeKey,
    p_source_engine: input.sourceEngine,
    p_severity: input.severity,
    p_title: input.title,
    p_message: input.message ?? "",
    p_now: input.nowIso ?? new Date().toISOString(),
  });
  if (error) throw error;
  const r = data as { alert_id: number; created: boolean; occurrence_count: number };
  return { alertId: Number(r.alert_id), created: r.created === true, occurrenceCount: Number(r.occurrence_count) };
}

/** Resolves the unresolved alert with this `dedupeKey`, if any; returns how many were resolved. */
export async function resolveDeduplicatedAlert(companyId: string, dedupeKey: string, resolvedBy: string, nowIso?: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_resolve_deduplicated_alert", {
    p_company_id: companyId,
    p_dedupe_key: dedupeKey,
    p_resolved_by: resolvedBy,
    p_now: nowIso ?? new Date().toISOString(),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function linkAlertNotification(companyId: string, alertId: number, notificationId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("operations_alerts").update({ related_notification_id: notificationId }).eq("company_id", companyId).eq("id", alertId);
  if (error) throw error;
}

export async function updateAlertStatus(
  companyId: string,
  alertId: number,
  fields: { status: AlertStatus; assignedTo?: string | null; acknowledgedBy?: string; acknowledgedAt?: string; resolvedBy?: string; resolvedAt?: string | null },
): Promise<OperationsAlert> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { status: fields.status };
  if (fields.assignedTo !== undefined) update.assigned_to = fields.assignedTo;
  if (fields.acknowledgedBy !== undefined) update.acknowledged_by = fields.acknowledgedBy;
  if (fields.acknowledgedAt !== undefined) update.acknowledged_at = fields.acknowledgedAt;
  if (fields.resolvedBy !== undefined) update.resolved_by = fields.resolvedBy;
  if (fields.resolvedAt !== undefined) update.resolved_at = fields.resolvedAt;

  const { data, error } = await supabase.from("operations_alerts").update(update).eq("company_id", companyId).eq("id", alertId).select("*").single<OperationsAlertRow>();
  if (error) throw error;
  return operationsAlertFromRow(data);
}
