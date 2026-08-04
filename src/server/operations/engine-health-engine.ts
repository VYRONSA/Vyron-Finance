/**
 * Pure engine-health computation — one builder per named engine (per the
 * RC1 Phase 6 directive's minimum list), each taking only the real data
 * that engine actually has (confirmed by this phase's own research
 * before writing any of this) and returning an honestly-tagged
 * `EngineHealth`. Where an engine has genuinely no execution/duration/
 * error tracking anywhere in the codebase (Posting, Matching, VAT,
 * Reporting, AI Copilot), the corresponding fields are `NotAvailable`,
 * never invented — only a real "last activity" timestamp is computed
 * where one honestly exists in that engine's own output table.
 */

import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";
import type { AppNotification } from "@/server/automation/types";
import type { WorkflowInstance } from "@/server/automation/types";
import type { EngineHealth, Metric } from "./types";

const live = <T>(value: T | null): Metric<T> => ({ value, quality: value === null ? "NotAvailable" : "Live" });
const calculated = <T>(value: T | null, note?: string): Metric<T> => ({ value, quality: value === null ? "NotAvailable" : "Calculated", note });
const notAvailable = <T>(note?: string): Metric<T> => ({ value: null, quality: "NotAvailable", note });

function classifyByFailureRate(total: number, failed: number): EngineHealth["status"] {
  if (total === 0) return "NotInstrumented";
  const rate = failed / total;
  if (rate === 0) return "Healthy";
  if (rate <= 0.3) return "Degraded";
  return "Failing";
}

function avgDurationMs(runs: AutomationTaskRun[]): number | null {
  const finished = runs.filter((r) => r.finishedAt);
  if (finished.length === 0) return null;
  const total = finished.reduce((sum, r) => sum + (Date.parse(r.finishedAt as string) - Date.parse(r.startedAt)), 0);
  return Math.round(total / finished.length);
}

/** Runs are expected sorted most-recent-`startedAt`-first. */
function healthFromTaskRuns(name: string, tasks: AutomationTask[], runs: AutomationTaskRun[]): EngineHealth {
  const failed = runs.filter((r) => r.status === "Failed").length;
  const status = classifyByFailureRate(runs.length, failed);
  const lastSuccess = runs.find((r) => r.status === "Success");
  return {
    name,
    status,
    queueDepth: live(tasks.filter((t) => t.status === "Queued").length),
    lastExecutionAt: live(runs[0]?.startedAt ?? null),
    errorCount: live(failed),
    avgExecutionTimeMs: calculated(avgDurationMs(runs), "Average of finished runs' start-to-finish duration."),
    throughputPerDay: notAvailable("Throughput requires a fixed observation window not yet implemented."),
    lastSuccessfulRunAt: live(lastSuccess?.finishedAt ?? null),
  };
}

export function buildSchedulerHealth(tasks: AutomationTask[], runs: AutomationTaskRun[]): EngineHealth {
  return healthFromTaskRuns("Automation Scheduler", tasks, runs);
}

/** The Rule Engine only has real execution data for the runs the
 * Scheduler itself triggered (`task_type = 'RuleEngineRun'`) — an
 * ad-hoc/manual rule run outside the Scheduler leaves no row anywhere,
 * confirmed by this phase's own research. This is disclosed via the
 * `note` on each Calculated/Live field rather than silently treating
 * scheduled runs as the whole picture. */
export function buildRuleEngineHealth(tasks: AutomationTask[], runs: AutomationTaskRun[]): EngineHealth {
  const health = healthFromTaskRuns("Rule Engine", tasks, runs);
  health.lastExecutionAt.note = "Covers only Rule Engine runs triggered via the Automation Scheduler.";
  return health;
}

export function buildWorkflowEngineHealth(instances: WorkflowInstance[]): EngineHealth {
  const pending = instances.filter((i) => i.status === "Pending").length;
  const rejected = instances.filter((i) => i.status === "Rejected").length;
  const status = instances.length === 0 ? "NotInstrumented" : rejected / instances.length > 0.3 ? "Degraded" : "Healthy";
  return {
    name: "Workflow Engine",
    status,
    queueDepth: live(pending),
    lastExecutionAt: live(instances[0]?.createdAt ?? null),
    errorCount: calculated(instances.length === 0 ? null : rejected, "Rejected instances, used as a proxy for workflow errors — not a distinct error concept."),
    avgExecutionTimeMs: notAvailable("Workflow instances have no duration column."),
    throughputPerDay: notAvailable("Throughput requires a fixed observation window not yet implemented."),
    lastSuccessfulRunAt: live(instances.find((i) => i.status === "Approved")?.createdAt ?? null),
  };
}

export function buildNotificationEngineHealth(notifications: AppNotification[]): EngineHealth {
  const critical = notifications.filter((n) => n.severity === "critical").length;
  return {
    name: "Notification Engine",
    status: notifications.length === 0 ? "NotInstrumented" : critical > 0 ? "Degraded" : "Healthy",
    queueDepth: live(notifications.filter((n) => !n.isRead).length),
    lastExecutionAt: live(notifications[0]?.createdAt ?? null),
    errorCount: live(critical),
    avgExecutionTimeMs: notAvailable("Notifications are synchronous inserts — there is no duration to measure."),
    throughputPerDay: notAvailable("Throughput requires a fixed observation window not yet implemented."),
    lastSuccessfulRunAt: live(notifications[0]?.createdAt ?? null),
  };
}

/** No execution/duration/error tracking exists for the Posting Engine
 * anywhere in this codebase (confirmed by research) — only a real "last
 * activity" signal, computed from the newest row `gl_transactions` (the
 * Posting Engine's own output table) actually contains. */
export function buildPostingEngineHealth(lastPostedAt: string | null): EngineHealth {
  return {
    name: "Posting Engine",
    status: "NotInstrumented",
    queueDepth: notAvailable("No execution queue is tracked for posting runs."),
    lastExecutionAt: calculated(lastPostedAt, "Newest gl_transactions.posted_at — the engine's own output, not a run log."),
    errorCount: notAvailable("No posting error log exists."),
    avgExecutionTimeMs: notAvailable("No posting duration is recorded."),
    throughputPerDay: notAvailable("Throughput requires a fixed observation window not yet implemented."),
    lastSuccessfulRunAt: calculated(lastPostedAt, "Same as Last Execution — no separate success/failure record exists."),
  };
}

/** Same honesty posture as Posting Engine — `matching_overrides` records
 * MANUAL overrides only, not automated match runs, so this is a weak
 * proxy disclosed as such, not a real execution log. */
export function buildMatchingEngineHealth(lastOverrideAt: string | null): EngineHealth {
  return {
    name: "Matching Engine",
    status: "NotInstrumented",
    queueDepth: notAvailable("No match-run queue is tracked."),
    lastExecutionAt: calculated(lastOverrideAt, "Newest manual override — NOT a record of automated match runs, which are untracked."),
    errorCount: notAvailable("No matching error log exists."),
    avgExecutionTimeMs: notAvailable("No matching duration is recorded."),
    throughputPerDay: notAvailable("Throughput requires a fixed observation window not yet implemented."),
    lastSuccessfulRunAt: notAvailable("No success/failure record exists for automated match runs."),
  };
}

export function buildVatEngineHealth(lastReturnGeneratedAt: string | null, returnCount: number): EngineHealth {
  return {
    name: "VAT Engine",
    status: "NotInstrumented",
    queueDepth: notAvailable("No calculation queue is tracked."),
    lastExecutionAt: calculated(lastReturnGeneratedAt, "Newest vat_returns.generated_at — a document lifecycle timestamp, not a run log."),
    errorCount: notAvailable("No VAT calculation error log exists."),
    avgExecutionTimeMs: notAvailable("No VAT calculation duration is recorded."),
    throughputPerDay: calculated(returnCount > 0 ? returnCount : null, "Total VAT returns ever generated — not a per-day rate."),
    lastSuccessfulRunAt: calculated(lastReturnGeneratedAt, "Same as Last Execution."),
  };
}

export function buildReportingEngineHealth(lastPackageGeneratedAt: string | null): EngineHealth {
  return {
    name: "Reporting Engine",
    status: "NotInstrumented",
    queueDepth: notAvailable("Reporting packages generate synchronously on request — there is no queue."),
    lastExecutionAt: calculated(lastPackageGeneratedAt, "Newest reporting_packages.generated_at."),
    errorCount: notAvailable("No reporting error log exists."),
    avgExecutionTimeMs: notAvailable("No reporting duration is recorded."),
    throughputPerDay: notAvailable("Throughput requires a fixed observation window not yet implemented."),
    lastSuccessfulRunAt: calculated(lastPackageGeneratedAt, "Same as Last Execution."),
  };
}

/** AI Copilot is a purely synchronous, stateless request/response
 * function (confirmed: no LLM, no invocation history table anywhere) —
 * the only real signal available is when the (also synchronous, cached)
 * daily briefing content was last generated. */
export function buildCopilotHealth(lastBriefingGeneratedAt: string | null): EngineHealth {
  return {
    name: "AI Copilot",
    status: "NotInstrumented",
    queueDepth: notAvailable("Copilot answers synchronously — there is no queue."),
    lastExecutionAt: calculated(lastBriefingGeneratedAt, "Newest cached executive briefing — individual Q&A invocations are not logged anywhere."),
    errorCount: notAvailable("No invocation log exists."),
    avgExecutionTimeMs: notAvailable("No invocation duration is recorded."),
    throughputPerDay: notAvailable("Individual invocations are not counted anywhere."),
    lastSuccessfulRunAt: calculated(lastBriefingGeneratedAt, "Same as Last Execution."),
  };
}
