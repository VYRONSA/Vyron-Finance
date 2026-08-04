/**
 * Service layer for the RC1 Phase 6 Operations Centre — the ONE place
 * every subsystem's operational signal is assembled into a single
 * snapshot. Every data source is real (see the per-engine pure builders
 * under `src/server/operations/` for exactly which table backs which
 * field, and what's honestly `NotAvailable` because nothing tracks it).
 */

import * as taskRepo from "@/server/repositories/automation-task-repository";
import * as workflowRepo from "@/server/repositories/workflow-repository";
import * as notificationRepo from "@/server/repositories/notification-repository";
import * as glRepo from "@/server/repositories/gl-repository";
import * as overrideRepo from "@/server/repositories/matching-override-repository";
import * as vatReturnRepo from "@/server/repositories/vat-return-repository";
import * as vatExceptionRepo from "@/server/repositories/vat-exception-repository";
import * as reportingPackageRepo from "@/server/repositories/reporting-package-repository";
import * as copilotBriefingRepo from "@/server/repositories/copilot-briefing-repository";
import * as automationAuditRepo from "@/server/repositories/automation-audit-repository";
import * as permissionRepo from "@/server/repositories/permission-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as auditFindingRepo from "@/server/repositories/audit-finding-repository";
import * as opsRepo from "@/server/repositories/operations-repository";
import * as communicationRepo from "@/server/repositories/communication-repository";
import { getCompany } from "@/server/services/company-service";

import {
  buildCopilotHealth, buildMatchingEngineHealth, buildNotificationEngineHealth, buildPostingEngineHealth,
  buildReportingEngineHealth, buildRuleEngineHealth, buildSchedulerHealth, buildVatEngineHealth, buildWorkflowEngineHealth,
} from "@/server/operations/engine-health-engine";
import { buildBackgroundJobsSummary } from "@/server/operations/background-jobs-engine";
import { buildSecurityDashboardSummary } from "@/server/operations/security-dashboard-engine";
import { buildAuditDashboardSummary } from "@/server/operations/audit-dashboard-engine";
import { buildTenantHealth, type TenantHealth } from "@/server/operations/tenant-health-engine";
import { buildPerformanceSummary } from "@/server/operations/performance-engine";
import { listIntegrationHealth } from "@/server/operations/integration-health";
import { buildCommunicationDashboardSummary } from "@/server/communications/dashboard-engine";
import type { EngineHealth, EventSeverity, OperationsAlert, SystemEventType } from "@/server/operations/types";
import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

export const listAlerts = opsRepo.listAlerts;
export const listRecentSystemEvents = opsRepo.listRecentSystemEvents;

const RECENT_WINDOW_DAYS = 14;

function daysAgoIso(days: number, nowIso: string): string {
  return new Date(Date.parse(nowIso) - days * 24 * 60 * 60_000).toISOString();
}

/** Non-blocking — a logging failure must never break the caller's own
 * permission decision or business operation. */
export async function recordSystemEvent(companyId: string | null, eventType: SystemEventType, severity: EventSeverity, actor: string | null, detail: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try {
    await opsRepo.recordSystemEvent({ companyId, eventType, severity, actor, detail, metadata });
  } catch {
    // Never break the caller over an observability write.
  }
}

export async function createAlert(input: opsRepo.NewOperationsAlert): Promise<OperationsAlert> {
  return opsRepo.createAlert(input);
}

export async function acknowledgeAlert(companyId: string, alertId: number, performedBy: string): Promise<OperationsAlert> {
  return opsRepo.updateAlertStatus(companyId, alertId, { status: "Acknowledged", acknowledgedBy: performedBy, acknowledgedAt: new Date().toISOString() });
}

export async function assignAlert(companyId: string, alertId: number, assignee: string): Promise<OperationsAlert> {
  return opsRepo.updateAlertStatus(companyId, alertId, { status: "Assigned", assignedTo: assignee });
}

export async function resolveAlert(companyId: string, alertId: number, performedBy: string): Promise<OperationsAlert> {
  return opsRepo.updateAlertStatus(companyId, alertId, { status: "Resolved", resolvedBy: performedBy, resolvedAt: new Date().toISOString() });
}

export async function reopenAlert(companyId: string, alertId: number): Promise<OperationsAlert> {
  return opsRepo.updateAlertStatus(companyId, alertId, { status: "Reopened", resolvedAt: null });
}

export type CompanyOperationsSnapshot = {
  companyId: string;
  companyName: string;
  engineHealth: EngineHealth[];
  communicationHealth: ReturnType<typeof buildCommunicationDashboardSummary>;
  backgroundJobs: ReturnType<typeof buildBackgroundJobsSummary>;
  integrationHealth: ReturnType<typeof listIntegrationHealth>;
  security: ReturnType<typeof buildSecurityDashboardSummary>;
  performance: ReturnType<typeof buildPerformanceSummary>;
  audit: ReturnType<typeof buildAuditDashboardSummary>;
  alerts: OperationsAlert[];
  tenantHealth: TenantHealth;
};

export async function buildCompanyOperationsSnapshot(companyId: string, nowIso: string): Promise<CompanyOperationsSnapshot> {
  const sinceIso = daysAgoIso(RECENT_WINDOW_DAYS, nowIso);

  const [
    company, tasks, recentRuns, runningRuns, instances, notifications, lastPostedAt, recentOverrides,
    vatReturns, openVatExceptions, reportingPackages, briefings, automationEntries, permissionEntries,
    reversedJournalCount, openFindings, systemEvents, alerts, communications,
  ] = await Promise.all([
    getCompany(companyId),
    taskRepo.listAutomationTasks(companyId),
    taskRepo.listRecentTaskRuns(companyId, sinceIso),
    taskRepo.listRecentTaskRuns(companyId, sinceIso).then((runs) => runs.filter((r) => r.status === "Running")),
    workflowRepo.listRecentWorkflowInstances(companyId, 200),
    notificationRepo.listNotifications(companyId, false, 200),
    glRepo.getLastPostedAt(companyId),
    overrideRepo.listRecentOverrides(companyId, 50),
    vatReturnRepo.listVatReturns(companyId),
    vatExceptionRepo.listVatExceptions(companyId, "Open"),
    reportingPackageRepo.listReportingPackages(companyId),
    copilotBriefingRepo.listCopilotBriefings(companyId, 5),
    automationAuditRepo.listAuditLog(companyId, 100),
    permissionRepo.listRecentPermissionAuditEntries(companyId, 20),
    journalRepo.countReversedJournals(companyId),
    auditFindingRepo.listAuditFindings(companyId, { status: "Open" }),
    opsRepo.listRecentSystemEvents(companyId, 100),
    opsRepo.listAlerts(companyId),
    communicationRepo.listCommunications(companyId),
  ]);

  const runsByType = groupRunsByType(tasks, recentRuns);
  const ruleEngineRuns = runsByType.RuleEngineRun ?? [];
  const schedulerRuns = recentRuns; // the Scheduler's own health spans every task type it runs

  const engineHealth: EngineHealth[] = [
    buildPostingEngineHealth(lastPostedAt),
    buildMatchingEngineHealth(recentOverrides[0]?.performedAt ?? null),
    buildRuleEngineHealth(tasks.filter((t) => t.taskType === "RuleEngineRun"), ruleEngineRuns),
    buildWorkflowEngineHealth(instances),
    buildSchedulerHealth(tasks, schedulerRuns),
    buildNotificationEngineHealth(notifications),
    buildVatEngineHealth(vatReturns[0]?.generatedAt ?? null, vatReturns.length),
    buildReportingEngineHealth(reportingPackages[0]?.generatedAt ?? null),
    buildCopilotHealth(briefings[0]?.generatedAt ?? null),
  ];

  const hasOverdueVatReturn = vatReturns.some((r) => (r.status === "Draft" || r.status === "Review") && r.periodEnd < nowIso.slice(0, 10));
  const failedTasks = tasks.filter((t) => t.status === "Failed").length;

  return {
    companyId,
    companyName: company?.name ?? companyId,
    engineHealth,
    communicationHealth: buildCommunicationDashboardSummary(communications, nowIso),
    backgroundJobs: buildBackgroundJobsSummary(tasks, runningRuns, nowIso),
    integrationHealth: listIntegrationHealth(),
    security: buildSecurityDashboardSummary(systemEvents),
    performance: buildPerformanceSummary(runsByType),
    audit: buildAuditDashboardSummary(automationEntries, permissionEntries, reversedJournalCount, recentOverrides.length, instances.filter((i) => i.status === "Rejected").length),
    alerts,
    tenantHealth: buildTenantHealth({
      companyId,
      companyName: company?.name ?? companyId,
      lastReportingPackageAt: reportingPackages[0]?.generatedAt ?? null,
      openVatExceptionsCount: openVatExceptions.length,
      hasOverdueVatReturn,
      openAuditFindingsCount: openFindings.length,
      automationFailedTaskCount: failedTasks,
      automationTotalTaskCount: tasks.length,
    }),
  };
}

/** `automation_task_runs` has no `task_type` column of its own (it only
 * references `task_id`) — group by joining each run back to its task's
 * own `taskType` via an in-memory map, rather than a second query. */
function groupRunsByType(tasks: AutomationTask[], runs: AutomationTaskRun[]): Record<string, AutomationTaskRun[]> {
  const taskTypeById = new Map(tasks.map((t) => [t.id, t.taskType]));
  const result: Record<string, AutomationTaskRun[]> = {};
  for (const run of runs) {
    const taskType = taskTypeById.get(run.taskId);
    if (!taskType) continue;
    (result[taskType] ??= []).push(run);
  }
  return result;
}
