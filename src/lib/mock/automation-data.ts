/**
 * Preview Mode seed data for the Recurring Transactions & Autonomous
 * Automation Platform (Migration Roadmap Module 7). Field shapes match
 * the real domain types exactly.
 */

import type {
  AppNotification,
  AutomationAuditLogEntry,
  AutomationTask,
  AutomationTaskRun,
  RecurringTemplate,
  WorkflowDefinition,
  WorkflowInstance,
} from "@/server/automation/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_RECURRING_TEMPLATES: RecurringTemplate[] = [
  {
    id: 1, companyId: COMPANY_ID, documentType: "CustomerInvoice", name: "Meridian Traders — Monthly Retainer",
    frequency: "Monthly", intervalCount: 1, startDate: "2026-01-01", endDate: null, maxOccurrences: null,
    occurrencesGenerated: 7, skipWeekends: true, skipPublicHolidays: false, nextRunDate: "2026-08-01", lastRunDate: "2026-07-01",
    isActive: true, numberingPrefix: "REC-INV-", documentPayload: { customerId: 1, vatTreatmentCode: "Standard", lines: [{ description: "Monthly retainer", quantity: 1, unitPrice: 8500 }] },
    workflowDefinitionId: null, createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-07-01T09:00:00Z", createdBy: "T. Naidoo", updatedBy: "System",
  },
  {
    id: 2, companyId: COMPANY_ID, documentType: "SupplierBill", name: "Netherfield Freight — Monthly Contract",
    frequency: "Monthly", intervalCount: 1, startDate: "2026-02-01", endDate: null, maxOccurrences: null,
    occurrencesGenerated: 6, skipWeekends: false, skipPublicHolidays: false, nextRunDate: "2026-08-01", lastRunDate: "2026-07-01",
    isActive: true, numberingPrefix: "REC-BILL-", documentPayload: { supplierId: 2, vatTreatmentCode: "Standard", subtotal: 4200 },
    workflowDefinitionId: null, createdAt: "2026-02-01T09:00:00Z", updatedAt: "2026-07-01T09:00:00Z", createdBy: "System", updatedBy: "System",
  },
  {
    id: 3, companyId: COMPANY_ID, documentType: "Journal", name: "Monthly Depreciation",
    frequency: "Monthly", intervalCount: 1, startDate: "2026-01-31", endDate: null, maxOccurrences: null,
    occurrencesGenerated: 7, skipWeekends: true, skipPublicHolidays: false, nextRunDate: "2026-08-31", lastRunDate: "2026-07-31",
    isActive: true, numberingPrefix: "", documentPayload: { journalType: "Depreciation", description: "Monthly depreciation", lines: [{ accountCode: "6500", debit: 1200, credit: 0 }, { accountCode: "1600", debit: 0, credit: 1200 }] },
    workflowDefinitionId: 1, createdAt: "2026-01-31T09:00:00Z", updatedAt: "2026-07-31T09:00:00Z", createdBy: "T. Naidoo", updatedBy: "System",
  },
  {
    id: 4, companyId: COMPANY_ID, documentType: "CustomerStatement", name: "Bramwell Dental — Monthly Statement",
    frequency: "Monthly", intervalCount: 1, startDate: "2026-03-01", endDate: null, maxOccurrences: null,
    occurrencesGenerated: 5, skipWeekends: true, skipPublicHolidays: false, nextRunDate: "2026-08-01", lastRunDate: "2026-07-01",
    isActive: true, numberingPrefix: "", documentPayload: { customerId: 2 },
    workflowDefinitionId: null, createdAt: "2026-03-01T09:00:00Z", updatedAt: "2026-07-01T09:00:00Z", createdBy: "System", updatedBy: "System",
  },
  {
    id: 5, companyId: COMPANY_ID, documentType: "PaymentReminder", name: "J. Fourie — 7-Day Payment Reminder",
    frequency: "Weekly", intervalCount: 1, startDate: "2026-06-01", endDate: "2026-12-31", maxOccurrences: 30,
    occurrencesGenerated: 8, skipWeekends: true, skipPublicHolidays: false, nextRunDate: "2026-08-03", lastRunDate: "2026-07-27",
    isActive: true, numberingPrefix: "", documentPayload: { recipientType: "Customer", recipientId: 3, message: "Your account has an overdue balance — please arrange payment." },
    workflowDefinitionId: null, createdAt: "2026-06-01T09:00:00Z", updatedAt: "2026-07-27T09:00:00Z", createdBy: "K. van Wyk", updatedBy: "System",
  },
];

export const MOCK_AUTOMATION_TASKS: AutomationTask[] = [
  {
    id: 1, companyId: COMPANY_ID, taskType: "RecurringTemplate", referenceId: 1, name: "Meridian Traders — Monthly Retainer",
    status: "Success", nextRunAt: "2026-08-01T00:00:00Z", lastRunAt: "2026-07-01T06:00:00Z", lastRunStatus: "Success",
    lastRunDurationMs: 840, retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-01-01T09:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, taskType: "RecurringTemplate", referenceId: 2, name: "Netherfield Freight — Monthly Contract",
    status: "Success", nextRunAt: "2026-08-01T00:00:00Z", lastRunAt: "2026-07-01T06:00:05Z", lastRunStatus: "Success",
    lastRunDurationMs: 610, retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-02-01T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, taskType: "RecurringTemplate", referenceId: 3, name: "Monthly Depreciation",
    status: "Failed", nextRunAt: "2026-08-01T00:05:00Z", lastRunAt: "2026-07-31T06:00:10Z", lastRunStatus: "Failed",
    lastRunDurationMs: 320, retryCount: 1, maxRetries: 3, isActive: true, createdAt: "2026-01-31T09:00:00Z",
  },
  {
    id: 4, companyId: COMPANY_ID, taskType: "RuleEngineRun", referenceId: null, name: "Banking Rule Engine — Hourly",
    status: "Success", nextRunAt: "2026-08-01T15:00:00Z", lastRunAt: "2026-08-01T14:00:00Z", lastRunStatus: "Success",
    lastRunDurationMs: 2150, retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-06-05T09:00:00Z",
  },
];

export const MOCK_AUTOMATION_TASK_RUNS: AutomationTaskRun[] = [
  { id: 1, taskId: 1, companyId: COMPANY_ID, startedAt: "2026-08-01T06:00:00.000Z", finishedAt: "2026-08-01T06:00:00.840Z", status: "Success", errorMessage: null, summary: { outcome: "Success" } },
  { id: 2, taskId: 2, companyId: COMPANY_ID, startedAt: "2026-08-01T06:00:05.000Z", finishedAt: "2026-08-01T06:00:05.610Z", status: "Success", errorMessage: null, summary: { outcome: "Success" } },
  { id: 3, taskId: 3, companyId: COMPANY_ID, startedAt: "2026-08-01T06:00:10.000Z", finishedAt: "2026-08-01T06:00:10.320Z", status: "Failed", errorMessage: "Financial period is closed for 2026-08.", summary: {} },
  { id: 4, taskId: 4, companyId: COMPANY_ID, startedAt: "2026-08-01T14:00:00.000Z", finishedAt: "2026-08-01T14:00:02.150Z", status: "Success", errorMessage: null, summary: { processed: 6, autoPosted: 4, exceptionsRaised: 1 } },
];

export const MOCK_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: 1, companyId: COMPANY_ID, workflowType: "Approval", name: "Recurring Journal Activation",
    steps: [{ stepOrder: 0, name: "Finance Review", approverLabel: "Finance Manager" }, { stepOrder: 1, name: "Management Approval", approverLabel: "Managing Director" }],
    isActive: true, createdAt: "2026-01-15T09:00:00Z",
  },
];

export const MOCK_WORKFLOW_INSTANCES: WorkflowInstance[] = [
  { id: 1, companyId: COMPANY_ID, workflowDefinitionId: 1, subjectType: "RecurringTemplate", subjectId: 3, currentStep: 0, status: "Pending", createdAt: "2026-08-01T09:00:00Z" },
];

export const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: 1, companyId: COMPANY_ID, recipient: "Company-wide", notificationType: "AutomationFailure",
    title: "Recurring template \"Monthly Depreciation\" failed to generate", message: "Financial period is closed for 2026-08.",
    severity: "critical", isRead: false, emailStatus: "NotSent", relatedType: "RecurringTemplate", relatedId: 3, createdAt: "2026-08-01T06:00:10Z",
  },
  {
    id: 2, companyId: COMPANY_ID, recipient: "Company-wide", notificationType: "ApprovalRequest",
    title: "Approval requested: activate \"Monthly Depreciation\"", message: "",
    severity: "warning", isRead: false, emailStatus: "NotSent", relatedType: "RecurringTemplate", relatedId: 3, createdAt: "2026-08-01T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, recipient: "Company-wide", notificationType: "TaskAssignment",
    title: "Payment reminder due: J. Fourie", message: "Your account has an overdue balance — please arrange payment.",
    severity: "info", isRead: true, emailStatus: "NotSent", relatedType: "Customer", relatedId: 3, createdAt: "2026-07-27T09:00:00Z",
  },
];

export const MOCK_AUDIT_LOG: AutomationAuditLogEntry[] = [
  {
    id: 1, companyId: COMPANY_ID, performedBy: "System", actionType: "RecurringGeneration:CustomerInvoice", ruleId: null,
    reason: "Scheduled occurrence of \"Meridian Traders — Monthly Retainer\".", changes: { summary: "Invoice REC-INV-8 for 9775.00" },
    journalIds: [201], documentType: "SalesInvoice", documentId: 1008, durationMs: 840, isReversible: false, createdAt: "2026-08-01T06:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, performedBy: "System", actionType: "RecurringGeneration:SupplierBill", ruleId: null,
    reason: "Scheduled occurrence of \"Netherfield Freight — Monthly Contract\".", changes: { summary: "Bill REC-BILL-7 for 4830.00" },
    journalIds: [202], documentType: "SupplierBill", documentId: 507, durationMs: 610, isReversible: false, createdAt: "2026-08-01T06:00:05Z",
  },
];
