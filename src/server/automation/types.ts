/**
 * Domain types for the Recurring Transactions & Autonomous Automation
 * Platform (Migration Roadmap Module 7). See
 * `supabase/migrations/0014_automation_platform.sql`.
 */

import type { RecurrenceFrequency } from "./recurrence";

export type RecurringDocumentType =
  | "CustomerInvoice" | "SupplierBill" | "Journal" | "InventoryAdjustment"
  | "CustomerStatement" | "SupplierStatement" | "ReminderEmail"
  | "PaymentReminder" | "PurchaseOrder" | "SalesOrder";

export const RECURRING_DOCUMENT_TYPES: RecurringDocumentType[] = [
  "CustomerInvoice", "SupplierBill", "Journal", "InventoryAdjustment",
  "CustomerStatement", "SupplierStatement", "ReminderEmail",
  "PaymentReminder", "PurchaseOrder", "SalesOrder",
];

export const RECURRING_DOCUMENT_LABELS: Record<RecurringDocumentType, string> = {
  CustomerInvoice: "Recurring Customer Invoice",
  SupplierBill: "Recurring Supplier Bill",
  Journal: "Recurring Journal",
  InventoryAdjustment: "Recurring Inventory Adjustment",
  CustomerStatement: "Recurring Customer Statement",
  SupplierStatement: "Recurring Supplier Statement",
  ReminderEmail: "Recurring Reminder Email",
  PaymentReminder: "Recurring Payment Reminder",
  PurchaseOrder: "Recurring Purchase Order",
  SalesOrder: "Recurring Sales Order",
};

export const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = ["Daily", "Weekly", "Monthly", "Quarterly", "Annually", "Custom"];

export type RecurringTemplate = {
  id: number;
  companyId: string;
  documentType: RecurringDocumentType;
  name: string;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  occurrencesGenerated: number;
  skipWeekends: boolean;
  skipPublicHolidays: boolean;
  nextRunDate: string;
  lastRunDate: string | null;
  isActive: boolean;
  numberingPrefix: string;
  documentPayload: Record<string, unknown>;
  workflowDefinitionId: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

export type GeneratedDocument = {
  id: number;
  companyId: string;
  recurringTemplateId: number;
  documentType: string;
  generatedAt: string;
  referenceType: string;
  referenceId: number | null;
  status: "Success" | "Failed";
  errorMessage: string | null;
  summary: string;
};

export type AutomationTaskType = "RecurringTemplate" | "RuleEngineRun" | "ReportRefresh" | "CommunicationQueue" | "Custom" | "SubscriptionLifecycleSweep";
export type AutomationTaskStatus = "Queued" | "Running" | "Success" | "Failed" | "Paused" | "Disabled";

export type AutomationTask = {
  id: number;
  companyId: string;
  taskType: AutomationTaskType;
  referenceId: number | null;
  name: string;
  status: AutomationTaskStatus;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  retryCount: number;
  maxRetries: number;
  isActive: boolean;
  createdAt: string;
};

export type AutomationTaskRun = {
  id: number;
  taskId: number;
  companyId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "Running" | "Success" | "Failed";
  errorMessage: string | null;
  summary: Record<string, unknown>;
};

export type WorkflowType = "Approval" | "Review" | "Exception" | "Audit";

export type WorkflowStepDefinition = { stepOrder: number; name: string; approverLabel: string };

export type WorkflowDefinition = {
  id: number;
  companyId: string;
  workflowType: WorkflowType;
  name: string;
  steps: WorkflowStepDefinition[];
  isActive: boolean;
  createdAt: string;
};

export type WorkflowInstanceStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

export type WorkflowInstance = {
  id: number;
  companyId: string;
  workflowDefinitionId: number;
  subjectType: string;
  subjectId: number;
  currentStep: number;
  status: WorkflowInstanceStatus;
  createdAt: string;
};

export type WorkflowInstanceStep = {
  id: number;
  instanceId: number;
  stepOrder: number;
  decidedBy: string;
  decision: "Approved" | "Rejected";
  note: string;
  decidedAt: string;
};

export type NotificationType =
  | "TaskAssignment" | "ExceptionAlert" | "ApprovalRequest" | "AutomationFailure"
  | "AuditWarning" | "RuleFailure" | "PeriodLockAlert" | "BillingAlert";

export type NotificationSeverity = "info" | "warning" | "critical";

export type AppNotification = {
  id: number;
  companyId: string;
  recipient: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  isRead: boolean;
  emailStatus: "NotSent" | "Sent" | "Failed";
  relatedType: string | null;
  relatedId: number | null;
  createdAt: string;
};

export type AutomationAuditLogEntry = {
  id: number;
  companyId: string;
  performedBy: string;
  actionType: string;
  ruleId: number | null;
  reason: string;
  changes: Record<string, unknown>;
  journalIds: number[];
  documentType: string | null;
  documentId: number | null;
  durationMs: number | null;
  isReversible: boolean;
  createdAt: string;
};
