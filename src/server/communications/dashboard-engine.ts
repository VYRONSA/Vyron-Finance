/**
 * Pure aggregation for the Communication Dashboard — every stat is
 * computed directly from the shared `communications` record, nothing
 * cached or duplicated. `delivered` stays 0 always: no channel today
 * reports a delivery-confirmation callback (an honest 0, not a
 * fabricated count, until a real provider with delivery webhooks is
 * plugged in — see `email-sender.ts`).
 */

import type { CommunicationRecord } from "./types";

export type FailureReasonCount = { reason: string; count: number };

export type CommunicationDashboardSummary = {
  queued: number;
  scheduled: number;
  sent: number;
  delivered: number;
  failed: number;
  retrying: number;
  awaitingApproval: number;
  cancelled: number;
  expired: number;
  averageDeliverySeconds: number | null;
  topFailureReasons: FailureReasonCount[];
};

export function buildCommunicationDashboardSummary(communications: CommunicationRecord[], nowIso: string): CommunicationDashboardSummary {
  let queued = 0;
  let scheduled = 0;
  let sent = 0;
  let failed = 0;
  let retrying = 0;
  let awaitingApproval = 0;
  let cancelled = 0;
  let expired = 0;
  const deliverySeconds: number[] = [];
  const failureReasonCounts = new Map<string, number>();

  for (const c of communications) {
    switch (c.status) {
      case "Queued":
        queued++;
        if (c.scheduledFor > nowIso) scheduled++;
        break;
      case "Sent":
        sent++;
        if (c.sentAt) deliverySeconds.push((Date.parse(c.sentAt) - Date.parse(c.createdAt)) / 1000);
        break;
      case "Failed":
        if (c.retryCount >= c.maxRetries) failed++;
        else retrying++;
        if (c.failureReason) failureReasonCounts.set(c.failureReason, (failureReasonCounts.get(c.failureReason) ?? 0) + 1);
        break;
      case "PendingApproval":
        awaitingApproval++;
        break;
      case "Cancelled":
        cancelled++;
        break;
      case "Expired":
        expired++;
        break;
      default:
        break;
    }
  }

  const averageDeliverySeconds = deliverySeconds.length > 0 ? deliverySeconds.reduce((a, b) => a + b, 0) / deliverySeconds.length : null;
  const topFailureReasons = [...failureReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { queued, scheduled, sent, delivered: 0, failed, retrying, awaitingApproval, cancelled, expired, averageDeliverySeconds, topFailureReasons };
}
