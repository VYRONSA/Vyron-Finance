import type { AlertStatus, EventSeverity, OperationsAlert, SystemEvent, SystemEventType } from "./types";

export type SystemEventRow = {
  id: number;
  company_id: string | null;
  event_type: string;
  severity: string;
  actor: string | null;
  detail: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function systemEventFromRow(row: SystemEventRow): SystemEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    eventType: row.event_type as SystemEventType,
    severity: row.severity as EventSeverity,
    actor: row.actor,
    detail: row.detail,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export type OperationsAlertRow = {
  id: number;
  company_id: string | null;
  source_engine: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  assigned_to: string | null;
  related_notification_id: number | null;
  created_by: string;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
};

export function operationsAlertFromRow(row: OperationsAlertRow): OperationsAlert {
  return {
    id: row.id,
    companyId: row.company_id,
    sourceEngine: row.source_engine,
    severity: row.severity as EventSeverity,
    title: row.title,
    message: row.message,
    status: row.status as AlertStatus,
    assignedTo: row.assigned_to,
    relatedNotificationId: row.related_notification_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
  };
}
