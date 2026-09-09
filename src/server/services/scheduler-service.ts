/**
 * The Automation Scheduler — the ONE shared queue every scheduled
 * activity in the platform executes through (Recurring Templates,
 * periodic Rule Engine runs, future scheduled work). No module builds
 * its own scheduling loop; a module that needs to run periodically
 * inserts one `automation_tasks` row and this service processes it.
 *
 * Real unattended (no-one-visiting-the-site) execution needs an external
 * trigger calling `runDueTasks` on a timer — `GET /api/automation/run-due-tasks`
 * (secured by `CRON_SECRET`/`AUTOMATION_CRON_SECRET`, see that route and
 * `require-cron-secret.ts`). Phase 27A — this IS wired up: `vercel.json`
 * configures Vercel's own native Cron Jobs feature to hit that route
 * every minute (`* * * * *`, the finest resolution standard cron syntax
 * offers, matching this project's Vercel Pro plan's per-minute minimum
 * interval). Before Phase 27A the same config existed but at `0 2 * * *`
 * (once daily) — functionally almost the same as no trigger at all for a
 * scheduler whose busiest task reschedules itself in minutes, not days;
 * the manual "Run Scheduler Now" action was, in practice, the only thing
 * that ever actually advanced it. That gap is closed now — this is
 * genuinely unattended in production. The manual action remains, for the
 * same reason the Rule Engine's own manual trigger does: an immediate,
 * on-demand run without waiting for the next tick.
 */

import * as taskRepo from "@/server/repositories/automation-task-repository";
import * as templateRepo from "@/server/repositories/recurring-template-repository";
import { generateFromTemplate } from "@/server/services/recurring-template-service";
import { runRuleEngine } from "@/server/services/rule-processing-service";
import { processCommunicationQueue } from "@/server/services/communication-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { runSubscriptionLifecycleSweep } from "@/server/billing-platform/engine/lifecycle-sweep-engine";
import { syncAllConnectedAccounts } from "@/server/bank-connectivity/bank-sync-service";
import { runAutomaticAiClassificationSweep } from "@/server/services/transaction-classification-service";
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

/** Phase 16, Part 8 — every company gets exactly one `BankSync` task,
 * self-healing the same way `syncSubscriptionLifecycleTask` does (a
 * company with no bank connections yet still gets a task; it just has
 * nothing to do each run — `syncAllConnectedAccounts` returns
 * `{attempted: 0, ...}` and the task simply succeeds trivially, cheaper
 * than conditionally creating/destroying the task as connections are
 * added/removed). One task covers every one of the company's connected
 * accounts — `syncAllConnectedAccounts` iterates all of them itself. */
export async function syncBankSyncTask(companyId: string, nowIso: string): Promise<void> {
  const tasks = await taskRepo.listAutomationTasks(companyId);
  if (tasks.some((t) => t.taskType === "BankSync")) return;
  await taskRepo.createAutomationTask(companyId, { taskType: "BankSync", name: "Direct bank feed sync", nextRunAt: nowIso });
}

/** Phase 25I — every company gets exactly one standing `RuleEngineRun`
 * task, self-healing the same way `syncBankSyncTask` does. Before this,
 * `RuleEngineRun` only ever ran via the manual "Run Scheduler Now"/"Run
 * Rules" action — there was no unattended recovery path for a
 * transaction left `journal_id IS NULL` after a partial Bank Sync/Import
 * failure (see `bank-sync-service.ts`'s and `import-service.ts`'s own
 * "already inserted on retry ≠ already Rule-processed" gap). `runRuleEngine`
 * already re-scans every company-wide unprocessed transaction each run
 * (`transaction-explorer-repository.ts::listUnprocessedTransactions`,
 * `journal_id IS NULL`, no time-window restriction) and
 * `processTransaction` is now safe to re-invoke on the same transaction
 * (Phase 25I's `getJournalBySource` duplicate-journal guard) — so simply
 * giving it a standing, periodic task closes the recovery gap without
 * inventing any new tracking/subsystem. */
export async function syncRuleEngineTask(companyId: string, nowIso: string): Promise<void> {
  const tasks = await taskRepo.listAutomationTasks(companyId);
  if (tasks.some((t) => t.taskType === "RuleEngineRun")) return;
  await taskRepo.createAutomationTask(companyId, { taskType: "RuleEngineRun", name: "Banking Rules recovery sweep", nextRunAt: nowIso });
}

/** Phase 26E — every company gets exactly one standing `AiClassificationSweep`
 * task, self-healing the same way `syncRuleEngineTask` does immediately
 * above (a company created before this feature shipped still gets one the
 * next time its scheduler runs, no migration backfill needed). This is
 * what makes existing/historical eligible transactions get classified
 * without a human selecting them one at a time: once this standing task
 * exists, every scheduler pass (manual "Run Scheduler Now", or a future
 * unattended cron trigger) processes one bounded batch
 * (`MAX_AI_CLASSIFICATIONS_PER_RUN`) of whatever's currently eligible,
 * and `nextTaskRunAt` below reschedules it soon rather than at the normal
 * hourly cadence for as long as a full batch keeps coming back — so a
 * backlog the size of the batch cap times a few scheduler passes drains
 * across those passes, never in one unbounded loop inside a single
 * request. */
export async function syncAiClassificationSweepTask(companyId: string, nowIso: string): Promise<void> {
  const tasks = await taskRepo.listAutomationTasks(companyId);
  if (tasks.some((t) => t.taskType === "AiClassificationSweep")) return;
  await taskRepo.createAutomationTask(companyId, { taskType: "AiClassificationSweep", name: "AI Classification sweep", nextRunAt: nowIso });
}

/** Phase 18C — the QA audit found that `runDueTasks` called
 * `syncBankSyncTask` unguarded, before the main due-task loop: if THAT
 * call ever throws (the missing-migration case it was found under, or
 * any other future failure), `runDueTasks` aborted immediately and
 * every other task type due that same pass — RecurringTemplate,
 * SubscriptionLifecycleSweep, RuleEngineRun, CommunicationQueue,
 * Custom — silently never ran either, for a reason having nothing to do
 * with them. This wraps ONLY that one bootstrap call so a BankSync
 * setup failure can never again take the rest of the scheduler run down
 * with it — `syncRecurringTemplateTasks`/`syncSubscriptionLifecycleTask`
 * and the main loop below are untouched. Capture/logging reuses the
 * EXACT existing convention `runDueTasks`'s own exhausted-retry branch
 * already uses lower in this file (`createNotification` +
 * `createAlert`, the alert wrapped in its own try/catch so a logging
 * failure can't cause a second outage) — never a fabricated success:
 * this function reports nothing back to its caller either way, so a
 * failure here can never be counted as a successful BankSync run (that
 * accounting only ever happens in the main loop, per real due task). */
async function ensureBankSyncTaskSafely(companyId: string, nowIso: string): Promise<void> {
  try {
    await syncBankSyncTask(companyId, nowIso);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    try {
      const notification = await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: "Automation Scheduler could not prepare the BankSync task",
        message: errorMessage,
        severity: "critical",
        relatedType: "BankSync",
        relatedId: null,
      });
      await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title: "Automation Scheduler could not prepare the BankSync task", message: errorMessage, relatedNotificationId: notification.id });
    } catch {
      // Never break the scheduler run over a logging/alerting failure —
      // same discipline the exhausted-retry branch below already uses.
    }
  }
}

/** Phase 25I — same wrap-only-the-bootstrap-call discipline as
 * `ensureBankSyncTaskSafely` above, applied to `syncRuleEngineTask`, so a
 * failure preparing the RuleEngineRun recovery task can never take the
 * rest of the scheduler run down with it either. */
async function ensureRuleEngineTaskSafely(companyId: string, nowIso: string): Promise<void> {
  try {
    await syncRuleEngineTask(companyId, nowIso);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    try {
      const notification = await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: "Automation Scheduler could not prepare the RuleEngineRun task",
        message: errorMessage,
        severity: "critical",
        relatedType: "RuleEngineRun",
        relatedId: null,
      });
      await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title: "Automation Scheduler could not prepare the RuleEngineRun task", message: errorMessage, relatedNotificationId: notification.id });
    } catch {
      // Never break the scheduler run over a logging/alerting failure —
      // same discipline the exhausted-retry branch below already uses.
    }
  }
}

/** Phase 26E — same wrap-only-the-bootstrap-call discipline as
 * `ensureRuleEngineTaskSafely` immediately above, applied to
 * `syncAiClassificationSweepTask`. */
async function ensureAiClassificationSweepTaskSafely(companyId: string, nowIso: string): Promise<void> {
  try {
    await syncAiClassificationSweepTask(companyId, nowIso);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    try {
      const notification = await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: "Automation Scheduler could not prepare the AiClassificationSweep task",
        message: errorMessage,
        severity: "critical",
        relatedType: "AiClassificationSweep",
        relatedId: null,
      });
      await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title: "Automation Scheduler could not prepare the AiClassificationSweep task", message: errorMessage, relatedNotificationId: notification.id });
    } catch {
      // Never break the scheduler run over a logging/alerting failure.
    }
  }
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

  if (task.taskType === "BankSync") {
    // Phase 16, Part 8 — reuses this EXACT queue, same precedent as
    // SubscriptionLifecycleSweep above. `syncAllConnectedAccounts`
    // itself never throws for a single account's failure (recorded
    // per-account instead), so a whole-task failure is only ever
    // determined here, from the aggregate outcome.
    //
    // Phase 25K — this used to RETURN `{status: "Failed", ...}` instead
    // of throwing, unlike every other branch here (`RecurringTemplate`
    // explicitly throws on its own outcome.status === "Failed"). Both
    // `runDueTasks` and `runTaskNow` only ever branch on whether `runTask`
    // THROWS — a returned `status` is silently discarded: `finishTaskRun`
    // was hardcoded "Success", `lastRunStatus` was hardcoded "Success",
    // `retryCount` was reset to 0, and the exhausted-retry
    // notification/alert (which only fires from the `catch` block) never
    // ran. A total, ongoing BankSync outage (revoked credentials,
    // provider down) would retry forever at the normal cadence with its
    // own run history claiming "Success" and nobody ever notified.
    // Throwing here — the same pattern `RecurringTemplate` already uses —
    // routes a genuine whole-task failure through the real
    // failed/retry/exhaustion-alert machinery every other task type gets.
    const outcome = await syncAllConnectedAccounts(companyId, nowIso, performedBy);
    if (outcome.failed > 0 && outcome.succeeded === 0 && outcome.attempted > 0) {
      throw new Error(`BankSync failed for all ${outcome.attempted} connected account(s).`);
    }
    return { status: "Success", summary: { ...outcome } };
  }

  if (task.taskType === "AiClassificationSweep") {
    // Phase 26E — same "throw only on a genuine total outage" precedent
    // as BankSync immediately above: `runAutomaticAiClassificationSweep`
    // never throws (a `noConfidentSuggestion`/`rateLimited`-only batch is
    // a normal, healthy outcome, not a failure), so a whole-task failure
    // is only ever raised here, from the aggregate outcome — every
    // transaction attempted failing outright (e.g. a missing/invalid AI
    // Gateway key) is the one case that should route through the real
    // failed/retry/exhaustion-alert machinery, exactly like a total
    // BankSync outage does.
    const outcome = await runAutomaticAiClassificationSweep(companyId, performedBy);
    if (outcome.attempted > 0 && outcome.failed === outcome.attempted) {
      throw new Error(`AI Classification sweep failed for all ${outcome.attempted} attempted transaction(s).`);
    }
    return { status: "Success", summary: { ...outcome } };
  }

  return { status: "Success", summary: {} };
}

export type SchedulerRunOutcome = { processed: number; succeeded: number; failed: number; deferred: number };

// Phase 25I — deliberately conservative: long enough that even a slow
// BankSync call against a real bank provider would have completed or
// itself thrown well before this, short enough that a genuinely stuck
// task doesn't stay broken for days waiting on a human to notice.
const STALE_RUNNING_THRESHOLD_MS = 30 * 60_000;

/** Phase 25I — stale-claim recovery. `claimTaskForRunning` correctly
 * guards against two overlapping runs both starting the SAME task, but
 * nothing previously ever revisited a task if the process that claimed
 * it crashed (OOM-kill, deploy restart, function timeout) before
 * `finishTaskRun`/`recordTaskOutcome` ever ran — `listDueTasks`'s own
 * WHERE clause excludes `Running`, so such a task was stuck there
 * forever, with the exhausted-retry notification path (which only runs
 * from inside the per-task `catch` block a crash would have skipped
 * entirely) never firing either. This reclaims any such task back to
 * `Failed`, feeding it through the SAME retry/backoff/exhaustion
 * accounting every other task failure already goes through — no new
 * subsystem, just the existing per-task claim/outcome machinery run
 * against tasks a normal pass would never look at again. The reclaim
 * itself is atomically guarded (`reclaimStaleRunningTask`'s own
 * `WHERE status = 'Running'`), so a task that finishes normally a split
 * second before this runs is left completely alone. */
async function reclaimStaleRunningTasksSafely(companyId: string, nowIso: string): Promise<void> {
  try {
    const staleBeforeIso = new Date(Date.parse(nowIso) - STALE_RUNNING_THRESHOLD_MS).toISOString();
    const staleTasks = await taskRepo.listStaleRunningTasks(companyId, staleBeforeIso);
    const stuckReason = "Reclaimed after being stuck in Running — the process that claimed this task likely crashed or was terminated before it could finish.";

    for (const task of staleTasks) {
      const openRun = await taskRepo.findOpenTaskRun(task.id);
      if (openRun) {
        await taskRepo.finishTaskRun(companyId, openRun.id, "Failed", stuckReason, {});
      }

      const retryCount = task.retryCount + 1;
      const exhausted = retryCount >= task.maxRetries;
      const reclaimed = await taskRepo.reclaimStaleRunningTask(companyId, task.id, {
        nextRunAt: exhausted ? nextTaskRunAt(task, nowIso) : new Date(Date.parse(nowIso) + 5 * 60_000).toISOString(),
        lastRunAt: nowIso,
        lastRunStatus: "Failed",
        retryCount,
      });

      if (reclaimed && exhausted) {
        try {
          const title = `Automation task "${task.name}" failed after ${retryCount} attempt(s)`;
          const notification = await createNotification(companyId, {
            notificationType: "AutomationFailure",
            title,
            message: stuckReason,
            severity: "critical",
            relatedType: task.taskType,
            relatedId: task.referenceId,
          });
          await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title, message: stuckReason, relatedNotificationId: notification.id });
        } catch {
          // Never break the scheduler run over a notification/alerting failure.
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    try {
      const notification = await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: "Automation Scheduler's stale-task recovery sweep failed",
        message: errorMessage,
        severity: "critical",
        relatedType: "Scheduler",
        relatedId: null,
      });
      await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title: "Automation Scheduler's stale-task recovery sweep failed", message: errorMessage, relatedNotificationId: notification.id });
    } catch {
      // Never break the scheduler run over a logging/alerting failure.
    }
  }
}

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
  await ensureBankSyncTaskSafely(companyId, nowIso);
  await ensureRuleEngineTaskSafely(companyId, nowIso);
  await ensureAiClassificationSweepTaskSafely(companyId, nowIso);
  await reclaimStaleRunningTasksSafely(companyId, nowIso);
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

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const task of due) {
    // Atomic claim — guards against an overlapping scheduler pass (or a
    // concurrent "Run Now" on the same task) executing this task twice.
    // A null claim means another process already has it; skip it this
    // pass rather than double-running it.
    const claimed = await taskRepo.claimTaskForRunning(companyId, task.id);
    if (!claimed) continue;
    processed++;
    const run = await taskRepo.startTaskRun(companyId, task.id);
    const start = performance.now();
    try {
      const { status, summary } = await runTask(companyId, task, todayIso, performedBy, nowIso);
      const durationMs = Math.round(performance.now() - start);
      await taskRepo.finishTaskRun(companyId, run.id, "Success", null, summary);
      await taskRepo.recordTaskOutcome(companyId, task.id, {
        status,
        nextRunAt: nextTaskRunAt(task, nowIso, summary),
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
      // Phase 25K — this sits AFTER finishTaskRun/recordTaskOutcome already
      // recorded a genuine Success. An unguarded failure here would fall
      // into the `catch` below and overwrite that Success with "Failed"
      // (incrementing retryCount, possibly firing a false exhausted-retry
      // alert) over a transient billing-metering error alone — same
      // defensive `.catch` guard already established for every other
      // `recordUsageEvent` call site.
      if (task.taskType !== "SubscriptionLifecycleSweep") {
        await recordUsageEvent(companyId, "automation_runs", 1, { taskType: task.taskType }, nowIso).catch(() => {});
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
        // Phase 25I — `createNotification` itself used to be unguarded
        // here (only the subsequent `createAlert` was wrapped): a real,
        // non-hypothetical failure (transient DB error, RLS
        // misconfiguration) would throw straight out of this `catch`
        // block, aborting `runDueTasks`'s `for` loop entirely — silently
        // skipping every OTHER due task for this company that pass, for
        // a reason having nothing to do with them. Same class of bug
        // `ensureBankSyncTaskSafely`/`ensureRuleEngineTaskSafely` already
        // guard against for the bootstrap calls above; extended here to
        // this notification/alert pair too.
        try {
          const notification = await createNotification(companyId, {
            notificationType: "AutomationFailure",
            title: `Automation task "${task.name}" failed after ${retryCount} attempt(s)`,
            message: errorMessage,
            severity: "critical",
            relatedType: task.taskType,
            relatedId: task.referenceId,
          });
          // RC1 Phase 6 — the same exhaustion moment that already creates
          // a notification also raises a real Operations Centre alert.
          await createAlert({ companyId, sourceEngine: "Automation Scheduler", severity: "critical", title: `Automation task "${task.name}" failed after ${retryCount} attempt(s)`, message: errorMessage, relatedNotificationId: notification.id });
        } catch {
          // Never break the scheduler run over a notification/alerting failure.
        }
      }
      failed++;
    }
  }

  return { processed, succeeded, failed, deferred };
}

/** Phase 26I — investigation found every AiClassificationSweep run
 * hitting the same provider rate limit on roughly the same attempt count
 * (see the Phase 26H audit), always paying the same flat 5-minute wait
 * regardless of how long the provider actually asked for. `runAutomaticAiClassificationSweep`
 * (via `classifyOne`'s `AIProviderError.retryAfterMs`, itself read from a
 * real `Retry-After` response header — `gateway-provider.ts::extractRetryAfterMs`)
 * now surfaces that real cooldown when the provider supplied one. This
 * clamps it to a safety floor (never faster than 15s, in case of a
 * malformed/zero header) and the EXISTING ceiling (never slower than the
 * flat 5 minutes this already used) — so the next sweep can start as
 * soon as the provider itself said it's safe to, never sooner, and never
 * later than before. A `retryAfterMs` of `null` (rate-limited, but no
 * header present) or absent falls back to the unchanged flat 5 minutes. */
const RATE_LIMIT_RESCHEDULE_FLOOR_MS = 15_000;
const RATE_LIMIT_RESCHEDULE_CEILING_MS = 5 * 60_000;

function rateLimitedRescheduleDelayMs(summary?: Record<string, unknown>): number {
  const retryAfterMs = summary?.retryAfterMs;
  if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs)) return RATE_LIMIT_RESCHEDULE_CEILING_MS;
  return Math.min(RATE_LIMIT_RESCHEDULE_CEILING_MS, Math.max(RATE_LIMIT_RESCHEDULE_FLOOR_MS, retryAfterMs));
}

function nextTaskRunAt(task: AutomationTask, nowIso: string, summary?: Record<string, unknown>): string {
  // RecurringTemplate tasks get their real next_run_at re-synced from the
  // template on the NEXT `syncRecurringTemplateTasks` pass (the template
  // itself already advanced past this run's date); the Communication
  // Queue needs a short cadence since messages are waiting on it;
  // RuleEngineRun/Custom tasks default to hourly until a task-specific
  // interval is configured.
  if (task.taskType === "RecurringTemplate") return nowIso;
  if (task.taskType === "CommunicationQueue") return new Date(Date.parse(nowIso) + 5 * 60_000).toISOString();
  // BankSync: FNB's documented API is polling-only, no push mechanism
  // confirmed (FINDINGS.md §14) — every 4 hours is a deliberately
  // conservative default cadence (undocumented rate limits, FINDINGS.md
  // §15), not a claim of real-time behaviour.
  if (task.taskType === "BankSync") return new Date(Date.parse(nowIso) + 4 * 60 * 60_000).toISOString();
  // SubscriptionLifecycleSweep: daily is enough resolution for trial/grace-period
  // expiry (the directive's own "Trial countdown" is a display concern on the
  // Customer Portal, not something the sweep itself needs to poll sub-daily for).
  if (task.taskType === "SubscriptionLifecycleSweep") return new Date(Date.parse(nowIso) + 24 * 60 * 60_000).toISOString();
  // Phase 26E — AiClassificationSweep paces itself off its own last
  // outcome: `hasMoreEligible` (a full batch came back, meaning more
  // historical backlog likely remains) or a rate-limit hit (the provider
  // asked us to slow down, not to stop trying) both reschedule soon
  // rather than waiting a full hour, so a backlog the size of several
  // batches drains across a few scheduler passes instead of one pass per
  // hour; an ordinary caught-up pass (nothing eligible, or a normal small
  // batch) falls back to the same hourly cadence RuleEngineRun already
  // uses for its own recovery sweep.
  if (task.taskType === "AiClassificationSweep") {
    const hasMoreEligible = summary?.hasMoreEligible === true;
    const rateLimited = typeof summary?.rateLimited === "number" && summary.rateLimited > 0;
    if (rateLimited) return new Date(Date.parse(nowIso) + rateLimitedRescheduleDelayMs(summary)).toISOString();
    if (hasMoreEligible) return new Date(Date.parse(nowIso) + 2 * 60_000).toISOString();
    return new Date(Date.parse(nowIso) + 60 * 60_000).toISOString();
  }
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
  // Atomic claim — same guard as `runDueTasks`, so a "Run Now" click
  // racing an already-in-progress scheduler pass (or a second click)
  // can't start this task running twice at once.
  const claimed = await taskRepo.claimTaskForRunning(companyId, task.id);
  if (!claimed) throw new ValidationError(`Task "${task.name}" is already running.`);
  const run = await taskRepo.startTaskRun(companyId, task.id);
  const start = performance.now();
  try {
    const { status, summary } = await runTask(companyId, task, todayIso, performedBy, nowIso);
    await taskRepo.finishTaskRun(companyId, run.id, "Success", null, summary);
    await taskRepo.recordTaskOutcome(companyId, task.id, {
      status,
      nextRunAt: nextTaskRunAt(task, nowIso, summary),
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
