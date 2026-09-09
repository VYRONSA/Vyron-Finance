/**
 * Domain types for the RC1 Phase 6 Operations Centre. Every quantitative
 * field is tagged with how it was obtained — `Live` (a direct read of a
 * real table right now), `Calculated` (derived/aggregated from real
 * data, e.g. an average or a "last activity" timestamp), or
 * `NotAvailable` (no instrumentation exists for this signal yet) — per
 * the Product Review Board's own explicit instruction never to fabricate
 * a monitoring value. See supabase/migrations/0030_operations_centre.sql.
 */

export type DataQuality = "Live" | "Calculated" | "NotAvailable";

export type Metric<T> = { value: T | null; quality: DataQuality; note?: string };

export const SYSTEM_EVENT_TYPES = ["PermissionDenied", "LoginFailed", "AccountLocked", "SessionExpired", "ApiAuthFailure"] as const;
export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

export type EventSeverity = "info" | "warning" | "high" | "critical";

export type SystemEvent = {
  id: number;
  companyId: string | null;
  eventType: SystemEventType;
  severity: EventSeverity;
  actor: string | null;
  detail: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export const ALERT_STATUSES = ["Open", "Acknowledged", "Assigned", "Resolved", "Reopened"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type OperationsAlert = {
  id: number;
  companyId: string | null;
  sourceEngine: string;
  severity: EventSeverity;
  title: string;
  message: string;
  status: AlertStatus;
  assignedTo: string | null;
  relatedNotificationId: number | null;
  createdBy: string;
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export type EngineStatus = "Healthy" | "Degraded" | "Failing" | "NotInstrumented";

export type EngineHealth = {
  name: string;
  status: EngineStatus;
  queueDepth: Metric<number>;
  lastExecutionAt: Metric<string>;
  errorCount: Metric<number>;
  avgExecutionTimeMs: Metric<number>;
  throughputPerDay: Metric<number>;
  lastSuccessfulRunAt: Metric<string>;
};

export type IntegrationStatus = {
  name: string;
  connected: boolean;
  lastSync: Metric<string>;
  lastError: Metric<string>;
  nextScheduledSync: Metric<string>;
  retryCount: Metric<number>;
  status: "Connected" | "Not Configured" | "Error";
};
