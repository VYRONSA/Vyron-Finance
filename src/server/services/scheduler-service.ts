/**
 * The Automation Scheduler — the ONE shared queue every scheduled
 * activity in the platform executes through (Recurring Templates,
 * periodic Rule Engine runs, future scheduled work). No module builds
 * its own scheduling loop; a module that needs to run periodically
 * inserts one `automation_tasks` row and this service processes it.
 *
 * Real unattended (no-one-visiting-the-site) execution needs an external
 * trigger calling `runAllDueTasks` on a timer — a Vercel Cron job or
 * Supabase `pg_cron` job hitting `POST /api/automation/run-due-tasks`
 * (secured by `AUTOMATION_CRON_SECRET`, see that route). Wiring the
 * actual external trigger is a deployment-configuration decision outside
 * this codebase (no `vercel.json`/cron config exists in this repo, and
 * none is added here unasked) — same honest boundary as Authentication
 * being "blocked on Supabase credentials" elsewhere in this platform.
 * Until that's configured, the manual "Run Scheduler Now" action (same
 * pattern as the Rule Engine's own manual trigger) is the real, working
 * path.
 */

import * as taskRepo from "@/server/repositories/automation-task-repository";
import * as templateRepo from "@/server/repositories/recurring-template-repository";
import { generateFromTemplate } from "@/server/services/recurring-template-service";
import { runRuleEngine } from "@/server/services/rule-processing-service";
import { processCommunicationQueue } from "@/server/services/communication-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { runSubscriptionLifecycleSweep } from "@/server/billing-platform/engine/lifecycle-sweep-engine";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { AutomationTask, AutomationTaskStatus } from "@/server/automation/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listAutomationTasks = taskRepo.listAutomationTasks;
export const getAutomationTask = taskRepo.getAutomationTask;

/** Ensures every active Recurring Template has a matching
 * `automation_tasks` row (creates one if missing) — a template is
 * authored once; the Scheduler is what actually tracks when it's due,
 * so this sync keeps the two in step without the template needing its
 * own execution loop. */
export async function syncRecurringTemplateTasks(companyId: string): Promise<void> {
  const [templates, tasks] = await Promise.all([templateRepo.listRecurringTemplates(companyId), taskRepo.listAutomationTasks(companyId)]);
  const existingReferenceIds = new Set(tasks.filter((t) => t.taskType === "RecurringTemplate").map((t) => t.referenceId));

  for (const template of templates) {
    if (existingReferenceIds.has(template.id)) continue;
    await taskRepo.createAutomationTask(companyId, {
      taskType: "RecurringTemplate",
      referenceId: template.id,
      name: template.name,
      nextRunAt: `${template.nextRunDate}T00:00:00.000Z`,
    });
  }
}

/** Commercial Billing Platform — "the Scheduler must own expiry." Every
 * company gets exactly one `SubscriptionLifecycleSweep` task,
 * self-healing the same way `syncRecurringTemplateTasks` does (created
 * on first need, not retrofitted onto every existing company via a
 * migration backfill, since a company created before this feature
 * shipped still gets one the next time its scheduler runs). `nowIso` as
 * the initial `next_run_at` means the very first sweep for a company
 * runs on its next scheduler pass, not a day later. */
export async function syncSubscriptionLifecycleTask(companyId: string, nowIso: string): Promise<void> {
  const tasks = await taskRepo.listAutomationTasks(companyId);
  if (tasks.some((t) => t.taskType === "SubscriptionLifecycleSweep")) return;
  await taskRepo.createAutomationTask(companyId, { taskType: "SubscriptionLifecycleSweep", name: "Subscription lifecycle sweep", nextRunAt: nowIso });
}

async function runTask(companyId: string, task: AutomationTask, todayIso: string, performedBy: string, nowIso: string): Promise<{ status: AutomationTaskStatus; summary: Record<string, unknown> }> {
  if (task.taskType === "RecurringTemplate") {
    if (task.referenceId === null) throw new Error("RecurringTemplate task has no referenceId.");
    const template = await templateRepo.getRecurringTemplate(companyId, task.referenceId);
    if (!template) throw new Error(`No recurring template with id ${task.referenceId}.`);
    const outcome = await generateFromTemplate(companyId, template, todayIso, performedBy);
    if (outcome.status === "Failed") throw new Error(outcome.reason ?? "Generation failed.");
    // Keep the task's own next_run_at in step with the template's.
    const refreshed = await templateRepo.getRecurringTemplate(companyId, template.id);
    return { status: "Success", summary: { outcome: outcome.status, nextRunDate: refreshed?.nextRunDate } };
  }

  if (task.taskType === "RuleEngineRun") {
    const outcome = await runRuleEngine(companyId, performedBy);
    return { status: "Success", summary: { processed: outcome.processed, autoPosted: outcome.autoPosted, exceptionsRaised: outcome.exceptionsRaised } };
  }

  if (task.taskType === "CommunicationQueue") {
    const outcome = await processCommunicationQueue(companyId, nowIso);
    return { status: "Success", summary: { processed: outcome.processed, sent: outcome.sent, failed: outcome.failed, expired: outcome.expired } };
  }

  if (task.taskType === "SubscriptionLifecycleSweep") {
    const outcome = await runSubscriptionLifecycleSweep(companyId, nowIso, performedBy);
    return { status: "Success", summary: { ...outcome } };
  }

  return { status: "Success", summary: {} };
}

export type SchedulerRunOutcome = { processed: number; succeeded: number; failed: number; deferred: number };

/** Processes every due task for one company — the manual "Run Scheduler
 * Now" trigger, and what the cron-secured route below calls per company.
 *
 * Commercial Billing Platform — "Automation limit exceeded -> automation
 * disabled," enforced through the one Licensing Engine, right here: a
 * company without the `automation` feature, or already at/over its
 * `max_automation_runs_monthly` limit, has every due task EXCEPT its own
 * `SubscriptionLifecycleSweep` deferred rather than run — the sweep
 * itself must always run regardless (it's what could lift a suspension,
 * not a feature the plan gates), so it is deliberately never subject to
 * this check. */
export async function runDueTasks(companyId: string, nowIso: string, performedBy = "System"): Promise<SchedulerRunOutcome> {
  await syncRecurringTemplateTasks(companyId);
  await syncSubscriptionLifecycleTask(companyId, nowIso);
  const todayIso = nowIso.slice(0, 10);
  const allDue = await taskRepo.listDueTasks(companyId, nowIso);

  const automationAllowed = (await hasFeature(companyId, "automation")) && (await checkUsageLimit(companyId, "max_automation_runs_monthly", 0)).allowed;

  const due: AutomationTask[] = [];
  let deferred = 0;
  for (const task of allDue) {
    if (task.taskType !== "SubscriptionLifecycleSweep" && !automationAllowed) {
      await taskRepo.deferTask(companyId, task.id, new Date(Date.parse(nowIso) + 24 * 60 * 60_000).toISOString());
      deferred++;
      continue;
    }
    due.push(task);
  }

  let succeeded = 0;
  let failed = 0;

  for (const task of due) {
    await taskRepo.setTaskStatus(companyId, task.id, "Running");
    const run = await taskRepo.startTaskRun(companyId, task.id);
    const start = performance.now();
    try {
      const { status, summary } = await runTask(companyId, task, todayIso, performedBy, nowIso);
      const durationMs = Math.round(performance.now() - start);
      await taskRepo.finishTaskRun(companyId, run.id, "Success", null, summary);
      await taskRepo.recordTaskOutcome(companyId, task.id, {
        status,
        nextRunAt: nextTaskRunAt(task, nowIso),
        lastRunAt: nowIso,
        lastRunStatus: "Success",
        lastRunDurationMs: durationMs,
        retryCount: 0,
      });
      // The Scheduler's own billing housekeeping (SubscriptionLifecycleSweep)
      // never counts against the company's own automation-runs usage —
      // metering it would be a self-referential trap (a company already
      // over its limit could never again run the one task that might lift
      // its suspension).
      if (task.taskType !== "SubscriptionLifecycleSweep") {
        await recordUsageEvent(companyId, "automation_runs", 1, { taskType: task.taskType }, nowIso);
      }
      succeeded++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error.";
      const durationMs = Math.round(performance.now() - start);
      await taskRepo.finishTaskRun(companyId, run.id, "Failed", errorMessage, {});
      const retryCount = task.retryCount + 1;
      const exhausted = retryCount >= task.maxRetries;
      await taskRepo.recordTaskOutcome(companyId, task.id, {
        status: "Failed",
        // Retry sooner (5 minutes) until retries are exhausted, then fall
        // back to the task's normal cadence so a permanently-broken
        // template doesn't retry forever in a tight loop.
        nextRunAt: exhausted ? nextTaskRunAt(task, nowIso) : new Date(Date.parse(nowIso) + 5 * 60_000).toISOString(),
        lastRunAt: nowIso,
        lastRunStatus: "Failed",
        lastRunDurationMs: durationMs,
        retryCount,
      });
      if (exhausted) {
        const notification = await createNotification(companyId, {
          notificationType: "AutomationFailure",
          title: `Automation task "${task.name}" failed after ${retryCount} attempt(s)`,
          message: errorMessage,
          severity: "critical",
          relatedType: task.taskType,
          relatedId: task.referenceId,
        });
        // RC1 Phase 6 — the same exhaustion moment that already creates a
        // notification also raises a real Operations Centre alert, fire-
        // and-forget so an alerting failure never breaks the scheduler run.
        try {
          await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title: `Automation task "${task.name}" failed after ${retryCount} attempt(s)`, message: errorMessage, relatedNotificationId: notification.id });
        } catch {
          // Never break the scheduler run over an alerting failure.
        }
      }
      failed++;
    }
  }

  return { processed: due.length, succeeded, failed, deferred };
}

function nextTaskRunAt(task: AutomationTask, nowIso: string): string {
  // RecurringTemplate tasks get their real next_run_at re-synced from the
  // template on the NEXT `syncRecurringTemplateTasks` pass (the template
  // itself already advanced past this run's date); the Communication
  // Queue needs a short cadence since messages are waiting on it;
  // RuleEngineRun/Custom tasks default to hourly until a task-specific
  // interval is configured.
  if (task.taskType === "RecurringTemplate") return nowIso;
  if (task.taskType === "CommunicationQueue") return new Date(Date.parse(nowIso) + 5 * 60_000).toISOString();
  // SubscriptionLifecycleSweep: daily is enough resolution for trial/grace-period
  // expiry (the directive's own "Trial countdown" is a display concern on the
  // Customer Portal, not something the sweep itself needs to poll sub-daily for).
  if (task.taskType === "SubscriptionLifecycleSweep") return new Date(Date.parse(nowIso) + 24 * 60 * 60_000).toISOString();
  return new Date(Date.parse(nowIso) + 60 * 60_000).toISOString();
}

export async function pauseTask(companyId: string, taskId: number): Promise<void> {
  await taskRepo.setTaskStatus(companyId, taskId, "Paused", false);
}

export async function resumeTask(companyId: string, taskId: number): Promise<void> {
  const task = await taskRepo.getAutomationTask(companyId, taskId);
  if (!task) throw new NotFoundError(`No automation task with id ${taskId}.`);
  await taskRepo.setTaskStatus(companyId, taskId, "Queued", true);
}

export async function disableTask(companyId: string, taskId: number): Promise<void> {
  await taskRepo.setTaskStatus(companyId, taskId, "Disabled", false);
}

/** Runs exactly one task right now, regardless of its `next_run_at` —
 * the "Manual run" requirement. */
export async function runTaskNow(companyId: string, taskId: number, nowIso: string, performedBy: string): Promise<void> {
  const task = await taskRepo.getAutomationTask(companyId, taskId);
  if (!task) throw new NotFoundError(`No automation task with id ${taskId}.`);
  const todayIso = nowIso.slice(0, 10);
  await taskRepo.setTaskStatus(companyId, task.id, "Running");
  const run = await taskRepo.startTaskRun(companyId, task.id);
  const start = performance.now();
  try {
    const { status, summary } = await runTask(companyId, task, todayIso, performedBy, nowIso);
    await taskRepo.finishTaskRun(companyId, run.id, "Success", null, summary);
    await taskRepo.recordTaskOutcome(companyId, task.id, {
      status,
      nextRunAt: nextTaskRunAt(task, nowIso),
      lastRunAt: nowIso,
      lastRunStatus: "Success",
      lastRunDurationMs: Math.round(performance.now() - start),
      retryCount: 0,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    await taskRepo.finishTaskRun(companyId, run.id, "Failed", errorMessage, {});
    await taskRepo.recordTaskOutcome(companyId, task.id, {
      status: "Failed",
      nextRunAt: nextTaskRunAt(task, nowIso),
      lastRunAt: nowIso,
      lastRunStatus: "Failed",
      lastRunDurationMs: Math.round(performance.now() - start),
      retryCount: task.retryCount + 1,
    });
    throw new ValidationError(errorMessage);
  }
}

export const listTaskRuns = taskRepo.listTaskRuns;
export const listRecentTaskRuns = taskRepo.listRecentTaskRuns;
