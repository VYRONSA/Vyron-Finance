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
import { createAlert, linkAlertNotification, raiseDeduplicatedAlert, resolveDeduplicatedAlert } from "@/server/services/operations-service";
import { runSubscriptionLifecycleSweep } from "@/server/billing-platform/engine/lifecycle-sweep-engine";
import { syncAllConnectedAccounts } from "@/server/bank-connectivity/bank-sync-service";
import { runAutomaticAiClassificationSweep, type AutomaticClassificationSweepOutcome } from "@/server/services/transaction-classification-service";
import {
  runSupplierInvoiceExtractionSweep,
  type ExtractionSweepOutcome as SupplierInvoiceExtractionOutcome,
} from "@/server/services/supplier-invoice-capture-service";
import { downloadDocumentFile, getDocument as getDocumentRecord } from "@/server/repositories/document-repository";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { sanitizeProviderMessage } from "@/server/ai/transaction-classification/safety-policy";
import type { AutomationTask, AutomationTaskStatus, AutomationTaskType } from "@/server/automation/types";

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

/** Phase 5L — one standing `SupplierInvoiceExtraction` task per company,
 * created the same way and for the same reason as the sweep above: the
 * work must belong to the server, so closing the browser cannot abandon a
 * document mid-capture. It does nothing at all when no document is queued,
 * so a company that never uses the feature pays nothing for it. */
export async function syncSupplierInvoiceExtractionTask(companyId: string, nowIso: string): Promise<void> {
  const tasks = await taskRepo.listAutomationTasks(companyId);
  if (tasks.some((t) => t.taskType === "SupplierInvoiceExtraction")) return;
  await taskRepo.createAutomationTask(companyId, {
    taskType: "SupplierInvoiceExtraction",
    name: "AI Supplier Invoice Capture",
    nextRunAt: nowIso,
  });
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

/** Migration 0100 — the most one Banking Rules sweep may run before it
 * stops starting new transactions (the cron request's own deadline can cut
 * it shorter). */
export const RULE_ENGINE_TASK_BUDGET_MS = 150_000;

async function runTask(
  companyId: string,
  task: AutomationTask,
  todayIso: string,
  performedBy: string,
  nowIso: string,
  taskRunId: number | null = null,
  deadlineAtMs?: number,
): Promise<{ status: AutomationTaskStatus; summary: Record<string, unknown> }> {
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
    // Migration 0100 — bounded: the sweep stops starting new transactions
    // at whichever comes first, its own budget or the request's deadline,
    // and reports what it left for the next run.
    const taskDeadline = Date.now() + RULE_ENGINE_TASK_BUDGET_MS;
    const outcome = await runRuleEngine(companyId, performedBy, { deadlineAtMs: deadlineAtMs === undefined ? taskDeadline : Math.min(deadlineAtMs, taskDeadline) });
    return {
      status: "Success",
      summary: {
        processed: outcome.processed,
        autoPosted: outcome.autoPosted,
        exceptionsRaised: outcome.exceptionsRaised,
        recovered: outcome.recovered,
        notPosted: outcome.notPosted,
        postingErrors: outcome.postingErrors,
        postingAttempts: outcome.postingAttempts,
        awaitingReview: outcome.awaitingReview,
        remaining: outcome.remaining,
        stoppedEarly: outcome.stoppedEarly,
        stopReason: outcome.stopReason,
        intelligenceSkipped: outcome.intelligenceSkipped,
        // Phase 5A — per-outcome counts only (no transaction data).
        outcomes: outcome.outcomes,
      },
    };
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
    //
    // Phase 5C — the rule pass attached to a scheduled sync now honours
    // the request's own deadline, as the RuleEngineRun branch above
    // already did. Before this it was the one unbounded posting path in
    // the scheduler: a large first sync could run past the cron's
    // 200-second work budget and be killed by the 300-second platform
    // limit mid-pass. `mayPost` is deliberately NOT passed — this is the
    // service_role path, authenticated by the cron secret, and it keeps
    // posting exactly as it does today.
    const outcome = await syncAllConnectedAccounts(companyId, nowIso, performedBy, { deadlineAtMs });
    if (outcome.failed > 0 && outcome.succeeded === 0 && outcome.attempted > 0) {
      throw new Error(`BankSync failed for all ${outcome.attempted} connected account(s).`);
    }
    return { status: "Success", summary: { ...outcome } };
  }

  if (task.taskType === "AiClassificationSweep") {
    // Migration 0099 — three kinds of problem, handled separately:
    //  * AI/provider failures are the provider circuit breaker's job: the
    //    batch stops, the circuit decides when to try again, and ONE
    //    deduplicated alert reports it. The task itself did its job.
    //  * Classification outcomes (no confidence, invalid answers) are the
    //    queue's job: cooldown / human review per transaction.
    //  * Only infrastructure failures (the safety store or every database
    //    read/write failing) fail the task, so retries -> Suspended apply.
    let outcome: AutomaticClassificationSweepOutcome;
    try {
      outcome = await runAutomaticAiClassificationSweep(companyId, performedBy, { taskRunId, nowIso });
    } catch (err) {
      // Stored in the run, the suspension reason and alerts: sanitized first.
      throw new Error(`AI Classification sweep could not read its queue: ${sanitizeProviderMessage(err instanceof Error ? err.message : String(err)) ?? "unknown error"}`);
    }
    await reportAiSweepConditions(companyId, outcome, nowIso);
    if (outcome.infrastructureFailure) {
      throw new Error(
        `AI Classification sweep could not run safely (${outcome.stoppedReason ?? "database failures"})${outcome.providerMessage ? `: ${outcome.providerMessage}` : ""}`,
      );
    }
    return { status: "Success", summary: { ...outcome } };
  }

  if (task.taskType === "SupplierInvoiceExtraction") {
    // Phase 5L — VYRON AI Supplier Invoice Capture.
    //
    // Extraction runs HERE, not in the browser. VYRON COST orchestrated it
    // from the client — /upload then /extract per file — so closing the tab
    // left documents stranded at "uploaded" with nothing on the server to
    // pick them up. On this runner the work survives the browser and gets
    // task claiming, time limits, retries, suspension and audit for free.
    //
    // The same three-way split the AI Classification sweep uses applies:
    //  * provider failures are the circuit breaker's business — the batch
    //    stops and the task still did its job;
    //  * per-document outcomes (unreadable, needs review) are the capture's
    //    own state, not a task failure;
    //  * only an infrastructure failure fails the task.
    let extraction: SupplierInvoiceExtractionOutcome;
    try {
      extraction = await runSupplierInvoiceExtractionSweep(companyId, performedBy, {
        taskRunId,
        readDocument: (documentId) => readCaptureDocumentBytes(companyId, documentId),
      });
    } catch (err) {
      throw new Error(
        `Supplier invoice extraction could not run: ${sanitizeProviderMessage(err instanceof Error ? err.message : String(err)) || "unknown error"}`,
      );
    }
    return { status: "Success", summary: { ...extraction } };
  }

  return { status: "Success", summary: {} };
}

/** Phase 5L — reads a captured document's bytes for extraction.
 *
 * Goes through the ONE Document Platform storage path
 * (`document-repository.ts`), so tenant scoping, the bucket and the
 * storage conventions are the existing ones — never a per-feature upload
 * or download path.
 *
 * The bytes are handed straight to the provider boundary and are never
 * logged, previewed or persisted anywhere by this feature (Decision 2). */
async function readCaptureDocumentBytes(companyId: string, documentId: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const document = await getDocumentRecord(companyId, documentId);
  if (!document) throw new Error(`No document with id ${documentId}.`);
  const buffer = await downloadDocumentFile(document.storagePath);
  return { bytes: new Uint8Array(buffer), mimeType: document.mimeType };
}

/** Alerts are raised once per condition and updated on repeats; a
 * notification goes out when the alert is first raised, when it reaches
 * this many occurrences (escalation) and on recovery — never every hour. */
const ESCALATION_OCCURRENCES = 24;
const AI_PROVIDER_ALERT_KEY = "ai-classification:provider-unavailable";
const AI_DAILY_CAP_ALERT_KEY = "ai-classification:daily-cap";

function taskFailureDedupeKey(taskId: number): string {
  return `automation-task:${taskId}:failing`;
}

function describeAiSweepStop(outcome: AutomaticClassificationSweepOutcome): string {
  const parts = [`Stopped: ${outcome.stoppedReason ?? "n/a"}.`];
  if (outcome.errorCategory) parts.push(`Error category: ${outcome.errorCategory}${outcome.httpStatus ? ` (HTTP ${outcome.httpStatus})` : ""}.`);
  if (outcome.providerMessage) parts.push(`Provider said: ${outcome.providerMessage}`);
  if (outcome.circuitState) parts.push(`Circuit: ${outcome.circuitState}.`);
  if (outcome.requestsToday !== null) parts.push(`Provider requests today: ${outcome.requestsToday}/${outcome.dailyCap}.`);
  return parts.join(" ");
}

/** One deduplicated alert per condition for the AI sweep. Never throws. */
async function reportAiSweepConditions(companyId: string, outcome: AutomaticClassificationSweepOutcome, nowIso: string): Promise<void> {
  try {
    if (outcome.stoppedReason === "provider_failure" || outcome.stoppedReason === "circuit_open") {
      const title = "AI classification provider unavailable — classification requests are paused";
      const message = describeAiSweepStop(outcome);
      const alert = await raiseDeduplicatedAlert({ companyId, dedupeKey: AI_PROVIDER_ALERT_KEY, sourceEngine: "AI Classification", severity: "critical", title, message, nowIso });
      if (alert.created || alert.occurrenceCount === ESCALATION_OCCURRENCES) {
        const notification = await createNotification(companyId, {
          notificationType: "AutomationFailure",
          title: alert.created ? title : `AI classification provider still unavailable (${alert.occurrenceCount} checks)`,
          message,
          severity: "critical",
          relatedType: "AiClassificationSweep",
          relatedId: null,
        });
        if (alert.created) await linkAlertNotification(companyId, alert.alertId, notification.id);
      }
    } else if (outcome.providerRequests > 0) {
      // The provider answered normally at least once: recovery.
      const resolved = await resolveDeduplicatedAlert(companyId, AI_PROVIDER_ALERT_KEY, "AI Classification", nowIso);
      if (resolved > 0) {
        await createNotification(companyId, {
          notificationType: "AutomationFailure",
          title: "AI classification provider recovered",
          message: "The AI provider is answering classification requests again.",
          severity: "info",
          relatedType: "AiClassificationSweep",
          relatedId: null,
        });
      }
    }

    if (outcome.stoppedReason === "daily_cap") {
      const title = `AI classification paused for today: internal safety cap of ${outcome.dailyCap} provider requests reached`;
      const alert = await raiseDeduplicatedAlert({ companyId, dedupeKey: AI_DAILY_CAP_ALERT_KEY, sourceEngine: "AI Classification", severity: "warning", title, message: describeAiSweepStop(outcome), nowIso });
      if (alert.created) {
        const notification = await createNotification(companyId, { notificationType: "AutomationFailure", title, message: describeAiSweepStop(outcome), severity: "warning", relatedType: "AiClassificationSweep", relatedId: null });
        await linkAlertNotification(companyId, alert.alertId, notification.id);
      }
    } else if (outcome.providerRequests > 0) {
      await resolveDeduplicatedAlert(companyId, AI_DAILY_CAP_ALERT_KEY, "AI Classification", nowIso);
    }
  } catch {
    // Never break the scheduler run over an alerting failure.
  }
}

/** A task run failed. First failure of a streak: a warning notification.
 * Retries exhausted: ONE deduplicated critical alert (a repeat after a
 * manual resume updates it), with a notification when first raised and on
 * escalation. Never throws. */
async function reportTaskFailure(companyId: string, task: AutomationTask, retryCount: number, exhausted: boolean, errorMessage: string, nowIso: string): Promise<void> {
  try {
    if (exhausted) {
      const title = `Automation task "${task.name}" suspended after ${retryCount} consecutive failure(s)`;
      const alert = await raiseDeduplicatedAlert({ companyId, dedupeKey: taskFailureDedupeKey(task.id), sourceEngine: "Automation Scheduler", severity: "critical", title, message: errorMessage, nowIso });
      if (alert.created || alert.occurrenceCount === ESCALATION_OCCURRENCES) {
        const notification = await createNotification(companyId, {
          notificationType: "AutomationFailure",
          title: alert.created ? title : `Automation task "${task.name}" is still failing (${alert.occurrenceCount} occurrences)`,
          message: errorMessage,
          severity: "critical",
          relatedType: task.taskType,
          relatedId: task.referenceId,
        });
        if (alert.created) await linkAlertNotification(companyId, alert.alertId, notification.id);
      }
    } else if (retryCount === 1) {
      await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: `Automation task "${task.name}" failed — retrying`,
        message: errorMessage,
        severity: "warning",
        relatedType: task.taskType,
        relatedId: task.referenceId,
      });
    }
  } catch {
    // Never break the scheduler run over a notification/alerting failure.
  }
}

/** A task that had been failing (or was suspended) ran successfully again. Never throws. */
async function reportTaskRecovery(companyId: string, task: AutomationTask, nowIso: string): Promise<void> {
  if (task.retryCount === 0 && task.status !== "Suspended") return;
  try {
    const resolved = await resolveDeduplicatedAlert(companyId, taskFailureDedupeKey(task.id), "Automation Scheduler", nowIso);
    if (resolved > 0 || task.retryCount > 0) {
      await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: `Automation task "${task.name}" recovered`,
        message: "The task ran successfully again.",
        severity: "info",
        relatedType: task.taskType,
        relatedId: task.referenceId,
      });
    }
  } catch {
    // Never break the scheduler run over a notification/alerting failure.
  }
}

export type SchedulerRunOutcome = {
  processed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  /** Migration 0100 — due tasks not started because the caller's deadline
   * had passed; still due, so the next scheduler pass runs them. Present
   * only when non-zero. */
  postponed?: number;
  /** Phase 5E — due tasks this caller was not permitted to run (a posting
   * task without `Banking:Post`). Present only when non-zero, so the
   * cron path's outcome shape is unchanged. */
  refused?: number;
  refusedTasks?: RefusedSchedulerTask[];
};

export type SchedulerRunOptions = {
  /** Epoch ms after which no further task is started, and running work
   * (the Banking Rules sweep) stops starting new transactions. */
  deadlineAtMs?: number;
  /** Phase 5E — whether this caller may cause accounting journals to be
   * posted (`Banking:Post`). Only the manual "Run Scheduler Now" passes
   * it; the cron/service-role path omits it entirely and is therefore
   * completely unaffected.
   *
   * `false` does NOT fail the run: the queue is a loop of independently
   * claimed tasks, not one atomic operation, so the non-posting tasks
   * still run and each posting task is left UNCLAIMED, UNSTARTED and
   * still due — reported in `refusedTasks`. Nothing is silently omitted,
   * and nothing is marked as having run. */
  mayPost?: boolean;
};

/** Phase 5E — a due task this pass deliberately did not run, and why.
 * The task is untouched: not claimed, no run row, `next_run_at`
 * unchanged, so it is still due and the scheduled cron pass (which runs
 * under service_role and has no such restriction) still executes it. */
export type RefusedSchedulerTask = {
  taskId: number;
  taskType: AutomationTaskType;
  name: string;
  reason: string;
};

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
        // Migration 0099 — exhausted retries suspend the task instead of
        // letting it run forever at its normal cadence.
        await taskRepo.suspendTask(companyId, task.id, stuckReason, nowIso);
        await reportTaskFailure(companyId, task, retryCount, true, stuckReason, nowIso);
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
export async function runDueTasks(companyId: string, nowIso: string, performedBy = "System", options: SchedulerRunOptions = {}): Promise<SchedulerRunOutcome> {
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
  let postponed = 0;
  const refusedTasks: RefusedSchedulerTask[] = [];

  for (const task of due) {
    // Migration 0100 — never start a task the request no longer has time
    // for. It is left unclaimed and still due, so the next pass takes it.
    if (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
      postponed++;
      continue;
    }
    // Phase 5E — a manual "Run Scheduler Now" by someone without
    // `Banking:Post` runs the queue's non-posting tasks and leaves every
    // posting task alone. Checked BEFORE the claim, so the task keeps its
    // `next_run_at`, gains no run row and records no outcome: it is
    // simply still due, and the scheduled cron pass (service_role, no
    // such restriction) runs it as normal. Reported, never silent.
    if (options.mayPost === false && taskPostsAccounting(task.taskType)) {
      refusedTasks.push({
        taskId: task.id,
        taskType: task.taskType,
        name: task.name,
        reason: `Running this task posts accounting journals, which needs the "Banking:Post" permission. It was left due and unchanged.`,
      });
      continue;
    }
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
      const { status, summary } = await runTask(companyId, task, todayIso, performedBy, nowIso, run.id, options.deadlineAtMs);
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
      await reportTaskRecovery(companyId, task, nowIso);
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
        // Migration 0099 — exhausted retries SUSPEND the task (listDueTasks
        // never selects Suspended); before, "exhausted" only switched to
        // the normal cadence and the task kept failing forever.
        status: exhausted ? "Suspended" : "Failed",
        nextRunAt: exhausted ? nextTaskRunAt(task, nowIso) : new Date(Date.parse(nowIso) + 5 * 60_000).toISOString(),
        lastRunAt: nowIso,
        lastRunStatus: "Failed",
        lastRunDurationMs: durationMs,
        retryCount,
      });
      if (exhausted) {
        try {
          await taskRepo.suspendTask(companyId, task.id, errorMessage, nowIso);
        } catch {
          // The status is already Suspended; the reason is best-effort.
        }
      }
      // Phase 25I — guarded: a notification/alert failure must never abort
      // the rest of this company's due tasks.
      await reportTaskFailure(companyId, task, retryCount, exhausted, errorMessage, nowIso);
      failed++;
    }
  }

  // The base shape is unchanged, so the cron path's outcome — and every
  // existing assertion about it — stays exactly as it was; the two
  // optional fields appear only when they actually happened.
  const outcome: SchedulerRunOutcome = { processed, succeeded, failed, deferred };
  if (postponed > 0) outcome.postponed = postponed;
  if (refusedTasks.length > 0) {
    outcome.refused = refusedTasks.length;
    outcome.refusedTasks = refusedTasks;
  }
  return outcome;
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

export function nextTaskRunAt(task: AutomationTask, nowIso: string, summary?: Record<string, unknown>): string {
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
    // Migration 0099 — ONLY real progress (at least one suggestion saved)
    // with more eligible work justifies coming back in 2 minutes. A batch
    // of no-confidence answers or failures waits the normal hour; "still
    // eligible" alone never re-asks the same transactions.
    if (summary?.progress === true && hasMoreEligible) return new Date(Date.parse(nowIso) + 2 * 60_000).toISOString();
    return new Date(Date.parse(nowIso) + 60 * 60_000).toISOString();
  }
  // Migration 0100 — a Banking Rules sweep that stopped at its budget while
  // still posting (or recovering) comes back in 5 minutes to continue; one
  // that stopped without progress, or finished, waits the normal hour.
  if (task.taskType === "RuleEngineRun") {
    const progress = (typeof summary?.autoPosted === "number" ? summary.autoPosted : 0) + (typeof summary?.recovered === "number" ? summary.recovered : 0);
    if (summary?.stoppedEarly === true && progress > 0) return new Date(Date.parse(nowIso) + 5 * 60_000).toISOString();
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
  // A fresh retry budget and the suspension cleared — never automatic.
  await taskRepo.resumeAutomationTask(companyId, taskId);
}

export async function disableTask(companyId: string, taskId: number): Promise<void> {
  await taskRepo.setTaskStatus(companyId, taskId, "Disabled", false);
}

/** Phase 5D/5E — the ONE classification of which task types can cause an
 * accounting journal to be posted. Every caller (manual "Run task now",
 * manual "Run Scheduler Now") asks this rather than comparing task-type
 * strings itself, so the answer cannot drift between them.
 *
 * Every task type in `AutomationTaskType` is listed explicitly and was
 * traced to what it actually calls — nothing is classified by assumption:
 *
 * | Task type                  | Posts? | What it reaches |
 * |----------------------------|--------|-----------------|
 * | RuleEngineRun              | YES    | `runRuleEngine` -> `fn_post_rule_engine_journal` |
 * | BankSync                   | YES    | `syncAllConnectedAccounts` -> the attached rule pass -> the same atomic posting |
 * | RecurringTemplate          | YES    | `generateFromTemplate`: a Journal template writes an Approved journal then `postApprovedJournals`; CustomerInvoice/SupplierBill templates call `approveAndPostInvoice`/`approveAndPostBill`; InventoryAdjustment carries a journal |
 * | AiClassificationSweep      | no     | writes `suggested_gl_account` only — the same field a manual GL assignment writes |
 * | CommunicationQueue         | no     | `processCommunicationQueue` — sends queued messages |
 * | SubscriptionLifecycleSweep | no     | `runSubscriptionLifecycleSweep` — billing lifecycle, no ledger write |
 * | ReportRefresh              | no     | no branch in `runTask` — a no-op today |
 * | Custom                     | no     | no branch in `runTask` — a no-op today |
 *
 * Phase 5E corrected `RecurringTemplate`, which Phase 5D had classified
 * as non-posting. It posts through the sales / purchasing / GL modules
 * rather than the banking ones, which is exactly why a string comparison
 * written from memory got it wrong and a traced, central predicate is
 * worth having.
 *
 * `AiClassificationSweep` stays out deliberately: sharing the scheduler
 * framework is not a reason to demand a posting permission. */
export function taskPostsAccounting(taskType: AutomationTaskType): boolean {
  switch (taskType) {
    case "RuleEngineRun":
    case "BankSync":
    case "RecurringTemplate":
      return true;
    case "AiClassificationSweep":
    // Phase 5L — VYRON AI Supplier Invoice Capture extracts documents and
    // writes only to its own capture tables. It creates no bill, no journal
    // and no ledger entry: conversion to a DRAFT bill is a separate,
    // explicit human action behind `Purchasing:Create`, and posting that
    // bill is the existing `approveAndPostBill` behind `Purchasing:Approve`.
    // So this task demands no posting permission — for the same reason
    // `AiClassificationSweep` does not.
    case "SupplierInvoiceExtraction":
    case "CommunicationQueue":
    case "SubscriptionLifecycleSweep":
    case "ReportRefresh":
    case "Custom":
      return false;
  }
}

/** Phase 5D — task states a manual run must REFUSE, and why.
 *
 * `Suspended` is a safety state: the scheduler sets it after exhausting
 * a task's retries (migration 0099), and so does the stale-claim
 * reclaim. Letting "Run now" execute it anyway would make the suspension
 * decorative — the point of it is that a person has to look at the task
 * and resume it. `Disabled` is a deliberate operator decision, treated
 * the same way.
 *
 * `Paused` is deliberately NOT here: pausing is a normal operational
 * control, and running a paused task by hand during controlled testing
 * is a real and useful thing to do. Either way a manual run never makes
 * a stopped task scheduled again (`keepStoppedStatus` below). */
const RUN_NOW_REFUSED_STATUSES: Partial<Record<AutomationTaskStatus, string>> = {
  Suspended: "This task is suspended and must be resumed before it can be run.",
  Disabled: "This task is disabled and must be resumed before it can be run.",
};

export type RunTaskNowOptions = {
  /** Phase 5D — whether the caller holds `Banking:Post`. Consulted only
   * for task types that post (`taskPostsAccounting`). The route is the
   * permission authority — it answers with `hasPermission` and returns a
   * real 403 that is recorded as a `PermissionDenied` event — and this is
   * the server-side backstop, so no caller reaches a posting run without
   * having answered the question. Omitted = permitted, which is what the
   * service-role/internal callers need. */
  mayPost?: boolean;
};

/** Runs exactly one task right now, regardless of its `next_run_at` —
 * the "Manual run" requirement.
 *
 * Phase 5D — the state and permission gates below are enforced HERE, not
 * only in the UI or the route, so no path reaches `runTask` around them.
 * They are checked BEFORE the task is claimed, so a refused run leaves
 * the task exactly as it was: no claim, no task-run row, no status
 * change, no retry-count change and — the point of the exercise — no
 * accounting write.
 *
 * This function is NOT on the scheduled path: cron calls `runDueTasks`,
 * whose `listDueTasks` already excludes Paused and Suspended tasks, so
 * none of this affects service-role execution. */
export async function runTaskNow(companyId: string, taskId: number, nowIso: string, performedBy: string, options: RunTaskNowOptions = {}): Promise<void> {
  const task = await taskRepo.getAutomationTask(companyId, taskId);
  if (!task) throw new NotFoundError(`No automation task with id ${taskId}.`);

  const refusal = RUN_NOW_REFUSED_STATUSES[task.status];
  if (refusal) throw new ValidationError(refusal);

  if (taskPostsAccounting(task.taskType) && options.mayPost === false) {
    throw new ValidationError(`Running this task posts accounting journals, which needs the "Banking:Post" permission.`);
  }

  const todayIso = nowIso.slice(0, 10);
  // Atomic claim — same guard as `runDueTasks`, so a "Run Now" click
  // racing an already-in-progress scheduler pass (or a second click)
  // can't start this task running twice at once.
  const claimed = await taskRepo.claimTaskForRunning(companyId, task.id);
  if (!claimed) throw new ValidationError(`Task "${task.name}" is already running.`);
  // A manual run of a task a person paused/disabled, or the scheduler
  // suspended, never makes it scheduled again — that takes Resume.
  const keepStoppedStatus = task.status === "Paused" || task.status === "Disabled" || task.status === "Suspended";
  const run = await taskRepo.startTaskRun(companyId, task.id);
  const start = performance.now();
  try {
    const { status, summary } = await runTask(companyId, task, todayIso, performedBy, nowIso, run.id);
    await taskRepo.finishTaskRun(companyId, run.id, "Success", null, summary);
    await taskRepo.recordTaskOutcome(companyId, task.id, {
      status: keepStoppedStatus ? task.status : status,
      nextRunAt: nextTaskRunAt(task, nowIso, summary),
      lastRunAt: nowIso,
      lastRunStatus: "Success",
      lastRunDurationMs: Math.round(performance.now() - start),
      retryCount: keepStoppedStatus ? task.retryCount : 0,
    });
    if (!keepStoppedStatus) await reportTaskRecovery(companyId, task, nowIso);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    await taskRepo.finishTaskRun(companyId, run.id, "Failed", errorMessage, {});
    await taskRepo.recordTaskOutcome(companyId, task.id, {
      status: keepStoppedStatus ? task.status : "Failed",
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
