/**
 * Automation Dashboard aggregates — pure, computed from already-fetched
 * data, same "no DB-side aggregate needed at this scale" approach as
 * `purchasing-summary-service.ts`/`banking-summary-service.ts`.
 */

import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

export type SchedulerHealth = "Healthy" | "Degraded" | "Down";

export type AutomationDashboardSummary = {
  automationRatePercent: number;
  tasksExecutedToday: number;
  tasksWaiting: number;
  failedTasks: number;
  retryQueueCount: number;
  ruleSuccessRatePercent: number;
  ruleFailureRatePercent: number;
  schedulerHealth: SchedulerHealth;
  averageProcessingTimeMs: number;
  topAutomatedProcesses: { name: string; successCount: number }[];
  manualInterventionRatePercent: number;
};

export function buildAutomationDashboardSummary(
  tasks: AutomationTask[],
  runsToday: AutomationTaskRun[],
  openExceptionCount: number,
  totalProcessedCount: number,
  topN = 5,
): AutomationDashboardSummary {
  const executedToday = runsToday.filter((r) => r.status !== "Running").length;
  const succeededToday = runsToday.filter((r) => r.status === "Success").length;
  const failedToday = runsToday.filter((r) => r.status === "Failed").length;

  const ruleSuccessRatePercent = executedToday === 0 ? 100 : Math.round((succeededToday / executedToday) * 1000) / 10;
  const ruleFailureRatePercent = executedToday === 0 ? 0 : Math.round((failedToday / executedToday) * 1000) / 10;

  const waiting = tasks.filter((t) => t.isActive && (t.status === "Queued" || t.status === "Success")).length;
  const failedTasks = tasks.filter((t) => t.status === "Failed").length;
  const retryQueueCount = tasks.filter((t) => t.status === "Failed" && t.retryCount > 0 && t.retryCount < t.maxRetries).length;

  const schedulerHealth: SchedulerHealth = failedTasks === 0 ? "Healthy" : failedTasks <= tasks.length * 0.2 ? "Degraded" : "Down";

  const runDurations = runsToday
    .filter((r) => r.finishedAt !== null)
    .map((r) => Date.parse(r.finishedAt as string) - Date.parse(r.startedAt));
  const averageProcessingTimeMs = runDurations.length === 0 ? 0 : Math.round(runDurations.reduce((sum, d) => sum + d, 0) / runDurations.length);

  const byName = new Map<string, number>();
  for (const run of runsToday) {
    if (run.status !== "Success") continue;
    const task = tasks.find((t) => t.id === run.taskId);
    const name = task?.name ?? `Task ${run.taskId}`;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const topAutomatedProcesses = [...byName.entries()]
    .map(([name, successCount]) => ({ name, successCount }))
    .sort((a, b) => b.successCount - a.successCount)
    .slice(0, topN);

  const automationRatePercent = totalProcessedCount === 0 ? 0 : Math.round(((totalProcessedCount - openExceptionCount) / totalProcessedCount) * 1000) / 10;
  const manualInterventionRatePercent = totalProcessedCount === 0 ? 0 : Math.round((openExceptionCount / totalProcessedCount) * 1000) / 10;

  return {
    automationRatePercent,
    tasksExecutedToday: executedToday,
    tasksWaiting: waiting,
    failedTasks,
    retryQueueCount,
    ruleSuccessRatePercent,
    ruleFailureRatePercent,
    schedulerHealth,
    averageProcessingTimeMs,
    topAutomatedProcesses,
    manualInterventionRatePercent,
  };
}
