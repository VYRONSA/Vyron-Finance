/**
 * Pure queue-selection and retry/backoff logic for the Communication
 * Platform's own send queue — the `communications` table's own
 * status/scheduled_for/retry_count columns ARE the queue (one row = one
 * job), mirroring the exact "what's due" predicate style the existing
 * Automation Scheduler's `automation_tasks.listDueTasks` already
 * established, rather than a second queue table. Actual periodic
 * *processing* is triggered by the Scheduler itself (a `CommunicationQueue`
 * automation task) — this file only decides, given a snapshot and "now",
 * what is due and when a failed send should retry next.
 */

import type { CommunicationPriority, CommunicationRecord } from "./types";

const PRIORITY_RANK: Record<CommunicationPriority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const BASE_RETRY_MINUTES = 5;
const MAX_RETRY_MINUTES = 60;

export function isExpired(communication: Pick<CommunicationRecord, "expiresAt">, nowIso: string): boolean {
  return communication.expiresAt !== null && nowIso > communication.expiresAt;
}

export function isRetryExhausted(communication: Pick<CommunicationRecord, "retryCount" | "maxRetries">): boolean {
  return communication.retryCount >= communication.maxRetries;
}

/** Exponential backoff capped at an hour — the 1st retry waits 5
 * minutes, the 2nd 10, the 3rd 20, ... never longer than
 * `MAX_RETRY_MINUTES`, matching the platform's existing "retry sooner,
 * cap it" convention (`scheduler-service.ts`'s own fixed 5-minute retry,
 * made exponential here since a per-message queue expects more attempts
 * over a shorter horizon than a periodic task). */
export function computeNextRetryAt(retryCountAfterFailure: number, nowIso: string): string {
  const delayMinutes = Math.min(BASE_RETRY_MINUTES * 2 ** Math.max(0, retryCountAfterFailure - 1), MAX_RETRY_MINUTES);
  return new Date(Date.parse(nowIso) + delayMinutes * 60_000).toISOString();
}

/** Every communication due to be (re)sent right now — `Queued` rows past
 * their `scheduled_for`, plus `Failed` rows whose backoff has elapsed and
 * haven't exhausted `max_retries`, excluding anything expired. Ordered by
 * priority (Urgent first) then `scheduled_for` (oldest first). */
export function selectDueCommunications(communications: CommunicationRecord[], nowIso: string): CommunicationRecord[] {
  return communications
    .filter((c) => {
      if (isExpired(c, nowIso)) return false;
      if (c.scheduledFor > nowIso) return false;
      if (c.status === "Queued") return true;
      if (c.status === "Failed") return c.nextRetryAt !== null && c.nextRetryAt <= nowIso && !isRetryExhausted(c);
      return false;
    })
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.scheduledFor.localeCompare(b.scheduledFor));
}

/** Every communication that's expired while still waiting to send (never
 * attempted, or exhausted its retries) — the "Expiry" requirement. Pure
 * so the service layer can compute this once per queue run and persist
 * `status = 'Expired'` for each. */
export function selectExpiredCommunications(communications: CommunicationRecord[], nowIso: string): CommunicationRecord[] {
  return communications.filter((c) => (c.status === "Queued" || c.status === "Failed") && isExpired(c, nowIso));
}
