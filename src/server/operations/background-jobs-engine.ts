/**
 * Pure aggregation over the Automation Scheduler's own queue
 * (`automation_tasks`/`automation_task_runs`) — the ONE shared queue
 * every scheduled activity in the platform already executes through, so
 * "Background Processing" is a direct read of it, not a second queue
 * concept invented for this dashboard.
 */

import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

export type BackgroundJobsSummary = {
  waiting: number;
  running: number;
  failed: number;
  retrying: number;
  longRunning: AutomationTaskRun[];
  stuckJobs: AutomationTaskRun[];
};

const LONG_RUNNING_MINUTES = 10;
const STUCK_MINUTES = 30;

/** No `updated_at` exists on `automation_tasks`/`automation_task_runs`
 * (confirmed by this phase's own research), so "stuck" is calculated
 * from the one timestamp that does exist — a `Running` run's own
 * `started_at` — rather than a heartbeat this schema has no column for. */
export function buildBackgroundJobsSummary(tasks: AutomationTask[], runningRuns: AutomationTaskRun[], nowIso: string): BackgroundJobsSummary {
  const now = Date.parse(nowIso);
  const longRunning = runningRuns.filter((r) => (now - Date.parse(r.startedAt)) / 60_000 >= LONG_RUNNING_MINUTES);
  const stuckJobs = runningRuns.filter((r) => (now - Date.parse(r.startedAt)) / 60_000 >= STUCK_MINUTES);

  return {
    waiting: tasks.filter((t) => t.status === "Queued").length,
    running: tasks.filter((t) => t.status === "Running").length,
    failed: tasks.filter((t) => t.status === "Failed").length,
    retrying: tasks.filter((t) => t.status === "Failed" && t.retryCount < t.maxRetries).length,
    longRunning,
    stuckJobs,
  };
}
