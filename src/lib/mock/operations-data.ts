import { MOCK_COMPANY } from "./financial-data";
import type { CompanyOperationsSnapshot } from "@/server/services/operations-service";
import { listIntegrationHealth } from "@/server/operations/integration-health";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_OPERATIONS_SNAPSHOT: CompanyOperationsSnapshot = {
  companyId: COMPANY_ID,
  companyName: MOCK_COMPANY.name,
  engineHealth: [
    { name: "Posting Engine", status: "NotInstrumented", queueDepth: { value: null, quality: "NotAvailable", note: "No execution queue is tracked for posting runs." }, lastExecutionAt: { value: "2026-08-01T09:12:00Z", quality: "Calculated", note: "Newest gl_transactions.posted_at." }, errorCount: { value: null, quality: "NotAvailable" }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-08-01T09:12:00Z", quality: "Calculated" } },
    { name: "Matching Engine", status: "NotInstrumented", queueDepth: { value: null, quality: "NotAvailable" }, lastExecutionAt: { value: "2026-07-30T14:02:00Z", quality: "Calculated", note: "Newest manual override — not a record of automated match runs." }, errorCount: { value: null, quality: "NotAvailable" }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: null, quality: "NotAvailable" } },
    { name: "Rule Engine", status: "Healthy", queueDepth: { value: 0, quality: "Live" }, lastExecutionAt: { value: "2026-08-02T06:00:00Z", quality: "Live", note: "Covers only Rule Engine runs triggered via the Automation Scheduler." }, errorCount: { value: 0, quality: "Live" }, avgExecutionTimeMs: { value: 842, quality: "Calculated" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-08-02T06:00:00Z", quality: "Live" } },
    { name: "Workflow Engine", status: "Healthy", queueDepth: { value: 2, quality: "Live" }, lastExecutionAt: { value: "2026-08-02T08:00:00Z", quality: "Live" }, errorCount: { value: 0, quality: "Calculated", note: "Rejected instances, used as a proxy for workflow errors." }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-08-01T11:00:00Z", quality: "Live" } },
    { name: "Automation Scheduler", status: "Healthy", queueDepth: { value: 1, quality: "Live" }, lastExecutionAt: { value: "2026-08-02T06:05:00Z", quality: "Live" }, errorCount: { value: 0, quality: "Live" }, avgExecutionTimeMs: { value: 1204, quality: "Calculated" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-08-02T06:05:00Z", quality: "Live" } },
    { name: "Notification Engine", status: "Healthy", queueDepth: { value: 3, quality: "Live" }, lastExecutionAt: { value: "2026-08-02T07:40:00Z", quality: "Live" }, errorCount: { value: 0, quality: "Live" }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-08-02T07:40:00Z", quality: "Live" } },
    { name: "VAT Engine", status: "NotInstrumented", queueDepth: { value: null, quality: "NotAvailable" }, lastExecutionAt: { value: "2026-07-25T10:00:00Z", quality: "Calculated" }, errorCount: { value: null, quality: "NotAvailable" }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: 4, quality: "Calculated", note: "Total VAT returns ever generated — not a per-day rate." }, lastSuccessfulRunAt: { value: "2026-07-25T10:00:00Z", quality: "Calculated" } },
    { name: "Reporting Engine", status: "NotInstrumented", queueDepth: { value: null, quality: "NotAvailable" }, lastExecutionAt: { value: "2026-07-31T16:00:00Z", quality: "Calculated" }, errorCount: { value: null, quality: "NotAvailable" }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-07-31T16:00:00Z", quality: "Calculated" } },
    { name: "AI Copilot", status: "NotInstrumented", queueDepth: { value: null, quality: "NotAvailable" }, lastExecutionAt: { value: "2026-08-02T05:00:00Z", quality: "Calculated", note: "Newest cached executive briefing — individual Q&A invocations are not logged anywhere." }, errorCount: { value: null, quality: "NotAvailable" }, avgExecutionTimeMs: { value: null, quality: "NotAvailable" }, throughputPerDay: { value: null, quality: "NotAvailable" }, lastSuccessfulRunAt: { value: "2026-08-02T05:00:00Z", quality: "Calculated" } },
  ],
  communicationHealth: {
    queued: 2, scheduled: 1, sent: 18, delivered: 0, failed: 1, retrying: 1, awaitingApproval: 2, cancelled: 0, expired: 0,
    averageDeliverySeconds: 3.4, topFailureReasons: [{ reason: "No email provider is configured for this deployment.", count: 2 }],
  },
  backgroundJobs: { waiting: 1, running: 1, failed: 0, retrying: 0, longRunning: [], stuckJobs: [] },
  integrationHealth: listIntegrationHealth(),
  security: {
    failedLogins: { count: 0, tracked: false }, permissionDenials: { count: 3, tracked: true }, suspiciousActivity: { count: 0, tracked: false },
    lockedAccounts: { count: 0, tracked: false }, expiredSessions: { count: 0, tracked: false }, apiAuthFailures: { count: 0, tracked: false },
    recentEvents: [
      { id: 1, companyId: COMPANY_ID, eventType: "PermissionDenied", severity: "warning", actor: "bookkeeper@harlow.example", detail: 'Your role ("Bookkeeper") does not have the "GeneralLedger:Reverse" permission.', metadata: {}, createdAt: "2026-08-02T09:10:00Z" },
    ],
  },
  performance: {
    schedulerTaskDurations: [
      { taskType: "RuleEngineRun", avgDurationMs: 842, lastDurationMs: 790, sampleCount: 12 },
      { taskType: "CommunicationQueue", avgDurationMs: 210, lastDurationMs: 198, sampleCount: 40 },
    ],
    slowestQueries: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
    slowestPages: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
    slowestReports: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
    slowestApis: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
    largestDatasets: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
    memoryUsage: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
    cpuUsage: { value: null, quality: "NotAvailable", note: "Not Available – Monitoring Provider Required" },
  },
  audit: {
    totalAutomationEntries: 46, recentCriticalEntries: [], permissionChangeCount: 5, recentPermissionChanges: [],
    journalReversalCount: 1, manualMatchingOverrideCount: 3, workflowOverrideCount: 0,
  },
  alerts: [
    { id: 1, companyId: COMPANY_ID, sourceEngine: "Communication Platform", severity: "critical", title: "Communication to Fenwick Office Supplies failed after 3 attempt(s)", message: "No email provider is configured for this deployment.", status: "Open", assignedTo: null, relatedNotificationId: 12, createdBy: "System", createdAt: "2026-08-02T08:20:00Z", acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null },
  ],
  tenantHealth: {
    companyId: COMPANY_ID, companyName: MOCK_COMPANY.name,
    lastBackup: { value: null, quality: "NotAvailable", note: "Backups are managed by the Supabase infrastructure layer and are not exposed to this application." },
    reportingReadiness: { value: "Last reporting package generated 2026-07-31T16:00:00Z", quality: "Calculated" },
    vatReadiness: { value: "No open VAT exceptions or overdue returns", quality: "Calculated" },
    auditReadiness: { value: "2 open audit finding(s)", quality: "Calculated" },
    automationHealth: { value: "0 of 6 automation task(s) currently failed", quality: "Calculated" },
    outstandingErrors: { value: 2, quality: "Calculated" },
  },
};
