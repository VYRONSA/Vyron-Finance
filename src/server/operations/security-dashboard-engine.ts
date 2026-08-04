/**
 * Pure aggregation over `system_events` — the Security Dashboard. Only
 * `PermissionDenied` is actually written anywhere in this codebase today
 * (wired into `permission-service.ts`'s own `forbidden()` — the single
 * real injection point every one of the ~200+ permission checks already
 * funnels through). `LoginFailed`/`AccountLocked`/`SessionExpired`/
 * `ApiAuthFailure` are real, valid `event_type` values with nothing
 * writing them yet — each metric below carries `tracked: false` for
 * those, rendered by the UI as "Not Available – instrumentation
 * pending," never a fabricated 0 that would misleadingly look identical
 * to "tracked, zero occurred."
 */

import type { SystemEvent, SystemEventType } from "./types";

export type SecurityMetric = { count: number; tracked: boolean };

export type SecurityDashboardSummary = {
  failedLogins: SecurityMetric;
  permissionDenials: SecurityMetric;
  suspiciousActivity: SecurityMetric;
  lockedAccounts: SecurityMetric;
  expiredSessions: SecurityMetric;
  apiAuthFailures: SecurityMetric;
  recentEvents: SystemEvent[];
};

const TRACKED_EVENT_TYPES: SystemEventType[] = ["PermissionDenied"];

function metricFor(events: SystemEvent[], eventType: SystemEventType): SecurityMetric {
  return { count: events.filter((e) => e.eventType === eventType).length, tracked: TRACKED_EVENT_TYPES.includes(eventType) };
}

export function buildSecurityDashboardSummary(events: SystemEvent[]): SecurityDashboardSummary {
  return {
    failedLogins: metricFor(events, "LoginFailed"),
    permissionDenials: metricFor(events, "PermissionDenied"),
    // "Suspicious activity" has no distinct event_type of its own yet —
    // never fabricated as a synthesized heuristic count.
    suspiciousActivity: { count: 0, tracked: false },
    lockedAccounts: metricFor(events, "AccountLocked"),
    expiredSessions: metricFor(events, "SessionExpired"),
    apiAuthFailures: metricFor(events, "ApiAuthFailure"),
    recentEvents: events.slice(0, 20),
  };
}
