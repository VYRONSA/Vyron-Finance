import type {
  AppNotification,
  AutomationAuditLogEntry,
  AutomationTask,
  AutomationTaskRun,
  AutomationTaskStatus,
  AutomationTaskType,
  GeneratedDocument,
  NotificationSeverity,
  NotificationType,
  RecurringDocumentType,
  RecurringTemplate,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowInstanceStep,
  WorkflowStepDefinition,
  WorkflowType,
} from "./types";
import type { RecurrenceFrequency } from "./recurrence";

export type RecurringTemplateRow = {
  id: number;
  company_id: string;
  document_type: string;
  name: string;
  frequency: string;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  occurrences_generated: number;
  skip_weekends: boolean;
  skip_public_holidays: boolean;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  numbering_prefix: string;
  document_payload: Record<string, unknown>;
  workflow_definition_id: number | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export function recurringTemplateFromRow(row: RecurringTemplateRow): RecurringTemplate {
  return {
    id: row.id,
    companyId: row.company_id,
    documentType: row.document_type as RecurringDocumentType,
    name: row.name,
    frequency: row.frequency as RecurrenceFrequency,
    intervalCount: row.interval_count,
    startDate: row.start_date,
    endDate: row.end_date,
    maxOccurrences: row.max_occurrences,
    occurrencesGenerated: row.occurrences_generated,
    skipWeekends: row.skip_weekends,
    skipPublicHolidays: row.skip_public_holidays,
    nextRunDate: row.next_run_date,
    lastRunDate: row.last_run_date,
    isActive: row.is_active,
    numberingPrefix: row.numbering_prefix,
    documentPayload: row.document_payload ?? {},
    workflowDefinitionId: row.workflow_definition_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export type GeneratedDocumentRow = {
  id: number;
  company_id: string;
  recurring_template_id: number;
  document_type: string;
  generated_at: string;
  reference_type: string;
  reference_id: number | null;
  status: string;
  error_message: string | null;
  summary: string;
};

export function generatedDocumentFromRow(row: GeneratedDocumentRow): GeneratedDocument {
  return {
    id: row.id,
    companyId: row.company_id,
    recurringTemplateId: row.recurring_template_id,
    documentType: row.document_type,
    generatedAt: row.generated_at,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    status: row.status as "Success" | "Failed",
    errorMessage: row.error_message,
    summary: row.summary,
  };
}

export type AutomationTaskRow = {
  id: number;
  company_id: string;
  task_type: string;
  reference_id: number | null;
  name: string;
  status: string;
  next_run_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_duration_ms: number | null;
  retry_count: number;
  max_retries: number;
  is_active: boolean;
  created_at: string;
};

export function automationTaskFromRow(row: AutomationTaskRow): AutomationTask {
  return {
    id: row.id,
    companyId: row.company_id,
    taskType: row.task_type as AutomationTaskType,
    referenceId: row.reference_id,
    name: row.name,
    status: row.status as AutomationTaskStatus,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastRunDurationMs: row.last_run_duration_ms,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export type AutomationTaskRunRow = {
  id: number;
  task_id: number;
  company_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_message: string | null;
  summary: Record<string, unknown>;
};

export function automationTaskRunFromRow(row: AutomationTaskRunRow): AutomationTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    companyId: row.company_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as "Running" | "Success" | "Failed",
    errorMessage: row.error_message,
    summary: row.summary ?? {},
  };
}

export type WorkflowDefinitionRow = {
  id: number;
  company_id: string;
  workflow_type: string;
  name: string;
  steps: WorkflowStepDefinition[];
  is_active: boolean;
  created_at: string;
};

export function workflowDefinitionFromRow(row: WorkflowDefinitionRow): WorkflowDefinition {
  return {
    id: row.id,
    companyId: row.company_id,
    workflowType: row.workflow_type as WorkflowType,
    name: row.name,
    steps: row.steps ?? [],
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export type WorkflowInstanceRow = {
  id: number;
  company_id: string;
  workflow_definition_id: number;
  subject_type: string;
  subject_id: number;
  current_step: number;
  status: string;
  created_at: string;
};

export function workflowInstanceFromRow(row: WorkflowInstanceRow): WorkflowInstance {
  return {
    id: row.id,
    companyId: row.company_id,
    workflowDefinitionId: row.workflow_definition_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    currentStep: row.current_step,
    status: row.status as WorkflowInstanceStatus,
    createdAt: row.created_at,
  };
}

export type WorkflowInstanceStepRow = {
  id: number;
  instance_id: number;
  step_order: number;
  decided_by: string;
  decision: string;
  note: string;
  decided_at: string;
};

export function workflowInstanceStepFromRow(row: WorkflowInstanceStepRow): WorkflowInstanceStep {
  return {
    id: row.id,
    instanceId: row.instance_id,
    stepOrder: row.step_order,
    decidedBy: row.decided_by,
    decision: row.decision as "Approved" | "Rejected",
    note: row.note,
    decidedAt: row.decided_at,
  };
}

export type NotificationRow = {
  id: number;
  company_id: string;
  recipient: string;
  notification_type: string;
  title: string;
  message: string;
  severity: string;
  is_read: boolean;
  email_status: string;
  related_type: string | null;
  related_id: number | null;
  created_at: string;
};

export function notificationFromRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    companyId: row.company_id,
    recipient: row.recipient,
    notificationType: row.notification_type as NotificationType,
    title: row.title,
    message: row.message,
    severity: row.severity as NotificationSeverity,
    isRead: row.is_read,
    emailStatus: row.email_status as "NotSent" | "Sent" | "Failed",
    relatedType: row.related_type,
    relatedId: row.related_id,
    createdAt: row.created_at,
  };
}

export type AutomationAuditLogRow = {
  id: number;
  company_id: string;
  performed_by: string;
  action_type: string;
  rule_id: number | null;
  reason: string;
  changes: Record<string, unknown>;
  journal_ids: number[];
  document_type: string | null;
  document_id: number | null;
  duration_ms: number | null;
  is_reversible: boolean;
  created_at: string;
};

export function auditLogEntryFromRow(row: AutomationAuditLogRow): AutomationAuditLogEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    performedBy: row.performed_by,
    actionType: row.action_type,
    ruleId: row.rule_id,
    reason: row.reason,
    changes: row.changes ?? {},
    journalIds: row.journal_ids ?? [],
    documentType: row.document_type,
    documentId: row.document_id,
    durationMs: row.duration_ms,
    isReversible: row.is_reversible,
    createdAt: row.created_at,
  };
}
