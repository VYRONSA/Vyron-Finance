/**
 * Application Service for Executive Alerts. `raiseAlert` is the one
 * place an alert gets created: it goes through the repository's
 * idempotent raise (so re-running detection doesn't duplicate an
 * already-open alert), then — only when a NEW alert was actually created
 * — fires a companion row into the existing Notification Centre (reusing
 * the "ExceptionAlert" `notification_type`, no schema change needed) so
 * the bell icon surfaces it too. `executive_alerts` stays the source of
 * truth for the Executive Alerts workspace; `notifications` is purely a
 * surfacing mechanism.
 */

import * as repo from "@/server/repositories/executive-alert-repository";
import { createNotification } from "@/server/services/notification-service";
import type { ExecutiveAlert } from "@/server/reporting/types";

export const listExecutiveAlerts = repo.listExecutiveAlerts;

export async function raiseAlert(companyId: string, input: repo.NewExecutiveAlert): Promise<ExecutiveAlert> {
  const { alert, created } = await repo.raiseAlertIdempotent(companyId, input);
  if (created) {
    await createNotification(companyId, {
      notificationType: "ExceptionAlert",
      title: `Executive Alert: ${input.alertType}`,
      message: input.reason,
      severity: input.priority === "Critical" || input.priority === "High" ? "critical" : "warning",
      relatedType: "executive_alert",
      relatedId: alert.id,
    });
  }
  return alert;
}

export async function resolveAlert(companyId: string, alertId: number, resolvedBy: string, note: string): Promise<ExecutiveAlert> {
  return repo.resolveAlert(companyId, alertId, resolvedBy, note);
}

export async function dismissAlert(companyId: string, alertId: number, resolvedBy: string, note: string): Promise<ExecutiveAlert> {
  return repo.dismissAlert(companyId, alertId, resolvedBy, note);
}
