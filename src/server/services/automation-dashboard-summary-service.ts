/**
 * Automation Dashboard aggregates — pure, computed from already-fetched
 * data, same "no DB-side aggregate needed at this scale" approach as
 * `purchasing-summary-service.ts`/`banking-summary-service.ts`.
 */

import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

export type SchedulerHealth = "Healthy" | "Degraded" | "Down";

/** Phase 29C — the forensic audit's own finding: `runTask`
 * (`scheduler-service.ts`) reports `status: "Success"` for an AI
 * Classification Sweep whenever it isn't a total failure — which
 * includes a run with `attempted: 0` (nothing eligible), a run that was
 * fully rate-limited (`rateLimited > 0`, zero classified/allocated), and
 * a run where the AI genuinely found nothing worth suggesting
 * (`noConfidentSuggestion` only). All three looked identical to a
 * productive run — an accountant skimming a green "Success" badge, a
 * "100% success rate," or "AiClassificationSweep ×5" under Top
 * Automated Processes could reasonably conclude the sweep is working
 * fine while it's actually done nothing for days.
 *
 * Deliberately does NOT change `status` itself (still "Success" — the
 * task genuinely didn't error, and changing that would be a scheduler
 * architecture change this phase's own instructions rule out) — this
 * only classifies the ALREADY-STORED summary object more honestly, for
 * both the per-task badge and the aggregate counters below to share. */
export type AiSweepOutcomeCategory = "progress" | "no-eligible" | "rate-limited" | "no-confident-suggestion" | "provider-unavailable" | "daily-cap";

function numberField(summary: Record<string, unknown>, key: string): number {
  const v = summary[key];
  return typeof v === "number" ? v : 0;
}

export function categorizeAiSweepRun(summary: Record<string, unknown>): AiSweepOutcomeCategory {
  const attempted = numberField(summary, "attempted");
  const classified = numberField(summary, "classified");
  const autoAllocated = numberField(summary, "autoAllocated");
  const rateLimited = numberField(summary, "rateLimited");
  const stoppedReason = summary.stoppedReason;
  if (classified > 0 || autoAllocated > 0) return "progress";
  // Migration 0099 — a run the circuit breaker or the daily safety cap
  // stopped is not "nothing eligible", even with zero attempts.
  if (stoppedReason === "provider_failure" || stoppedReason === "circuit_open") return "provider-unavailable";
  if (stoppedReason === "daily_cap") return "daily-cap";
  if (attempted === 0) return "no-eligible";
  if (rateLimited > 0) return "rate-limited";
  return "no-confident-suggestion";
}

/** `true` only for a run that genuinely accomplished something —
 * classified/auto-allocated at least one transaction, or isn't an
 * AiClassificationSweep at all (every other task type's "Success"
 * already means real, singular work was done — see e.g.
 * `RuleEngineRun`/`RecurringTemplate`, which don't have this
 * multi-outcome-collapsed-to-one-status shape). Shared by the aggregate
 * counters below and the per-task badge in `automation-dashboard-tab.tsx`
 * so both surfaces agree, never independently drifting definitions of
 * "productive." */
export function isGenuinelyProductiveRun(taskType: AutomationTask["taskType"], run: AutomationTaskRun): boolean {
  if (run.status !== "Success") return false;
  if (taskType !== "AiClassificationSweep") return true;
  return categorizeAiSweepRun(run.summary) === "progress";
}

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
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  // Phase 29C — `succeededToday`/`ruleSuccessRatePercent` now require
  // GENUINE progress (see `isGenuinelyProductiveRun`), not merely
  // `status === "Success"` — a day where the AI sweep ran 5 times with
  // nothing eligible or fully rate-limited previously showed as a
  // misleading "100% success rate."
  const executedToday = runsToday.filter((r) => r.status !== "Running").length;
  const succeededToday = runsToday.filter((r) => isGenuinelyProductiveRun(taskById.get(r.taskId)?.taskType ?? "Custom", r)).length;
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

  // Phase 29C — same fix as `succeededToday` above: "Top Automated
  // Processes" is explicitly a "how much did this accomplish" leaderboard,
  // so a task that ran repeatedly with zero real progress must not count.
  const byName = new Map<string, number>();
  for (const run of runsToday) {
    const task = taskById.get(run.taskId);
    if (!isGenuinelyProductiveRun(task?.taskType ?? "Custom", run)) continue;
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
