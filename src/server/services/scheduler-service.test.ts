/**
 * Phase 18C — `scheduler-service.ts` had no test coverage at all before
 * this file (confirmed: no `scheduler-service.test.ts` existed
 * anywhere). This file is scoped to exactly what the Phase 18C brief
 * requires: proving `runDueTasks` no longer lets a BankSync bootstrap
 * failure abort every other task type's processing for the same
 * company, while every existing task type's own behavior stays
 * unchanged. Every dependency is mocked — no real Supabase/network call
 * happens here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/automation-task-repository", () => ({
  listAutomationTasks: vi.fn(),
  getAutomationTask: vi.fn(),
  listDueTasks: vi.fn(),
  createAutomationTask: vi.fn(),
  setTaskStatus: vi.fn(),
  claimTaskForRunning: vi.fn(),
  deferTask: vi.fn(),
  recordTaskOutcome: vi.fn(),
  startTaskRun: vi.fn(),
  finishTaskRun: vi.fn(),
  listTaskRuns: vi.fn(),
  listRecentTaskRuns: vi.fn(),
  listStaleRunningTasks: vi.fn(),
  findOpenTaskRun: vi.fn(),
  reclaimStaleRunningTask: vi.fn(),
  suspendTask: vi.fn(),
  resumeAutomationTask: vi.fn(),
}));
vi.mock("@/server/repositories/recurring-template-repository", () => ({ listRecurringTemplates: vi.fn(), getRecurringTemplate: vi.fn() }));
vi.mock("@/server/services/recurring-template-service", () => ({ generateFromTemplate: vi.fn() }));
vi.mock("@/server/services/rule-processing-service", () => ({ runRuleEngine: vi.fn() }));
vi.mock("@/server/services/communication-service", () => ({ processCommunicationQueue: vi.fn() }));
vi.mock("@/server/services/notification-service", () => ({ createNotification: vi.fn() }));
vi.mock("@/server/services/operations-service", () => ({ createAlert: vi.fn(), raiseDeduplicatedAlert: vi.fn(), resolveDeduplicatedAlert: vi.fn(), linkAlertNotification: vi.fn() }));
vi.mock("@/server/billing-platform/engine/lifecycle-sweep-engine", () => ({ runSubscriptionLifecycleSweep: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-sync-service", () => ({ syncAllConnectedAccounts: vi.fn() }));
vi.mock("@/server/services/transaction-classification-service", () => ({ runAutomaticAiClassificationSweep: vi.fn() }));
vi.mock("@/server/billing-platform/engine/feature-flag-engine", () => ({ hasFeature: vi.fn() }));
vi.mock("@/server/billing-platform/engine/licensing-engine", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));

import { nextTaskRunAt, resumeTask, RULE_ENGINE_TASK_BUDGET_MS, runDueTasks, runTaskNow, taskPostsAccounting, ValidationError } from "./scheduler-service";
import * as taskRepo from "@/server/repositories/automation-task-repository";
import * as templateRepo from "@/server/repositories/recurring-template-repository";
import { runRuleEngine, type RuleEngineRunOutcome } from "@/server/services/rule-processing-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert, raiseDeduplicatedAlert, resolveDeduplicatedAlert } from "@/server/services/operations-service";
import type { AutomaticClassificationSweepOutcome } from "@/server/services/transaction-classification-service";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { syncAllConnectedAccounts } from "@/server/bank-connectivity/bank-sync-service";
import { runAutomaticAiClassificationSweep } from "@/server/services/transaction-classification-service";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { AutomationTask, AutomationTaskRun, AutomationTaskType } from "@/server/automation/types";
import { generateFromTemplate } from "@/server/services/recurring-template-service";

const NOW = "2026-08-12T10:00:00.000Z";

function ruleEngineOutcome(overrides: Partial<RuleEngineRunOutcome> = {}): RuleEngineRunOutcome {
  return {
    processed: 0,
    autoPosted: 0,
    exceptionsRaised: 0,
    recovered: 0,
    notPosted: 0,
    postingErrors: 0,
    postingAttempts: 0,
    awaitingReview: 0,
    remaining: 0,
    stoppedEarly: false,
    stopReason: null,
    intelligenceSkipped: false,
    outcomes: { posted: 0, recovered: 0, classified: 0, skipped: 0, refused: 0, failed: 0, "needs-review": 0, "not-permitted": 0 },
    results: [],
    ...overrides,
  };
}

function task(overrides: Partial<AutomationTask> & Pick<AutomationTask, "id" | "taskType">): AutomationTask {
  return {
    companyId: "co_1",
    referenceId: null,
    name: overrides.taskType,
    status: "Queued",
    nextRunAt: NOW,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunDurationMs: null,
    retryCount: 0,
    maxRetries: 3,
    isActive: true,
    createdAt: NOW,
    ...overrides,
  };
}

/** A complete sweep outcome; `progress` follows classified/autoAllocated unless given. */
function sweepOutcome(overrides: Partial<AutomaticClassificationSweepOutcome> = {}): AutomaticClassificationSweepOutcome {
  const base: AutomaticClassificationSweepOutcome = {
    attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0,
    providerRequests: 0, invalidResponses: 0, providerFailures: 0, databaseFailures: 0, heldByQueue: 0, stoppedReason: null,
    errorCategory: null, httpStatus: null, providerMessage: null, circuitState: "closed", requestsToday: 0, dailyCap: 100,
    infrastructureFailure: false, hasMoreEligible: false, progress: false, candidates: 0,
  };
  const merged = { ...base, ...overrides };
  if (overrides.progress === undefined) merged.progress = merged.classified + merged.autoAllocated > 0;
  return merged;
}

function mockSweep(overrides: Partial<AutomaticClassificationSweepOutcome>): void {
  vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue(sweepOutcome(overrides));
}

function run(overrides: Partial<AutomationTaskRun> = {}): AutomationTaskRun {
  return { id: 1, taskId: 1, companyId: "co_1", startedAt: NOW, finishedAt: null, status: "Running", errorMessage: null, summary: {}, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(templateRepo.listRecurringTemplates).mockResolvedValue([]);
  vi.mocked(taskRepo.listAutomationTasks).mockResolvedValue([]);
  vi.mocked(taskRepo.createAutomationTask).mockResolvedValue(task({ id: 99, taskType: "BankSync" }));
  vi.mocked(taskRepo.listDueTasks).mockResolvedValue([]);
  vi.mocked(taskRepo.setTaskStatus).mockResolvedValue(undefined);
  vi.mocked(taskRepo.claimTaskForRunning).mockImplementation(async (companyId, taskId) => task({ id: taskId, taskType: "RuleEngineRun", companyId, status: "Running" }));
  vi.mocked(taskRepo.recordTaskOutcome).mockResolvedValue(undefined);
  vi.mocked(taskRepo.startTaskRun).mockResolvedValue(run());
  vi.mocked(taskRepo.finishTaskRun).mockResolvedValue(undefined);
  vi.mocked(taskRepo.listStaleRunningTasks).mockResolvedValue([]);
  vi.mocked(taskRepo.findOpenTaskRun).mockResolvedValue(null);
  vi.mocked(taskRepo.reclaimStaleRunningTask).mockResolvedValue(true);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(checkUsageLimit).mockResolvedValue({ allowed: true, limit: null, used: 0 });
  vi.mocked(createNotification).mockResolvedValue({ id: 500 } as never);
  vi.mocked(createAlert).mockResolvedValue({ id: 700 } as never);
  vi.mocked(recordUsageEvent).mockResolvedValue(undefined);
  mockSweep({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false });
  vi.mocked(taskRepo.suspendTask).mockResolvedValue(undefined);
  vi.mocked(taskRepo.resumeAutomationTask).mockResolvedValue(undefined);
  vi.mocked(raiseDeduplicatedAlert).mockResolvedValue({ alertId: 900, created: true, occurrenceCount: 1 });
  vi.mocked(resolveDeduplicatedAlert).mockResolvedValue(0);
});

describe("runDueTasks — BankSync bootstrap succeeds (existing behavior unchanged)", () => {
  it("creates the BankSync bootstrap task and still processes a due RecurringTemplate-independent task normally", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 5, autoPosted: 2, exceptionsRaised: 1 }));

    const outcome = await runDueTasks("co_1", NOW);

    expect(taskRepo.createAutomationTask).toHaveBeenCalledWith("co_1", expect.objectContaining({ taskType: "BankSync" }));
    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(createNotification).not.toHaveBeenCalled();
    expect(createAlert).not.toHaveBeenCalled();
  });

  it("creates the RuleEngineRun bootstrap task too (Phase 25I recovery sweep)", async () => {
    await runDueTasks("co_1", NOW);

    expect(taskRepo.createAutomationTask).toHaveBeenCalledWith("co_1", expect.objectContaining({ taskType: "RuleEngineRun", name: "Banking Rules recovery sweep" }));
  });

  it("does not create a second RuleEngineRun task when one already exists", async () => {
    vi.mocked(taskRepo.listAutomationTasks).mockResolvedValue([task({ id: 5, taskType: "RuleEngineRun" })]);

    await runDueTasks("co_1", NOW);

    expect(taskRepo.createAutomationTask).not.toHaveBeenCalledWith("co_1", expect.objectContaining({ taskType: "RuleEngineRun" }));
  });

  it("a RuleEngineRun bootstrap failure does not stop the scheduler from processing other due tasks, and logs via the same notification/alert convention", async () => {
    vi.mocked(taskRepo.createAutomationTask).mockImplementation(async (companyId, input) => {
      if (input.taskType === "RuleEngineRun") throw new Error("automation_tasks insert failed");
      return task({ id: 1, taskType: input.taskType, companyId });
    });
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "CommunicationQueue" })]);
    const { processCommunicationQueue } = await import("@/server/services/communication-service");
    vi.mocked(processCommunicationQueue).mockResolvedValue({ processed: 1, sent: 1, failed: 0, expired: 0 });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ notificationType: "AutomationFailure", relatedType: "RuleEngineRun" }));
    expect(createAlert).toHaveBeenCalledTimes(1);
  });

  it("runs successfully even with nothing due at all (empty data)", async () => {
    const outcome = await runDueTasks("co_1", NOW);
    expect(outcome).toEqual({ processed: 0, succeeded: 0, failed: 0, deferred: 0 });
  });
});

describe("runDueTasks — BankSync bootstrap fails (Phase 18C resilience fix)", () => {
  function failBankSyncBootstrapOnly() {
    vi.mocked(taskRepo.createAutomationTask).mockImplementation(async (companyId, input) => {
      if (input.taskType === "BankSync") throw new Error("relation \"bank_connections\" does not exist");
      return task({ id: 1, taskType: input.taskType, companyId });
    });
  }

  it("BankSync bootstrap failure does not stop the scheduler from processing other due task types (the core fix)", async () => {
    failBankSyncBootstrapOnly();
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 3, autoPosted: 1, exceptionsRaised: 0 }));

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(runRuleEngine).toHaveBeenCalledWith("co_1", "System", { deadlineAtMs: expect.any(Number) });
  });

  it("captures/logs the BankSync bootstrap failure using the EXISTING notification+alert convention (error handling/logging conventions preserved)", async () => {
    failBankSyncBootstrapOnly();

    await runDueTasks("co_1", NOW);

    expect(createNotification).toHaveBeenCalledWith(
      "co_1",
      expect.objectContaining({
        notificationType: "AutomationFailure",
        severity: "critical",
        relatedType: "BankSync",
      }),
    );
    const notificationArg = vi.mocked(createNotification).mock.calls[0][1];
    expect(notificationArg.message).toContain("bank_connections");

    expect(createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co_1",
        sourceEngine: "Automation Scheduler",
        severity: "critical",
        relatedNotificationId: 500,
      }),
    );
  });

  it("never reports a fabricated success for the BankSync operation — a bootstrap failure with nothing else due yields an honest zero outcome, not a phantom success", async () => {
    failBankSyncBootstrapOnly();

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 0, succeeded: 0, failed: 0, deferred: 0 });
  });

  it("does not throw even if the notification/alert logging itself also fails (never break the scheduler run over a logging failure)", async () => {
    failBankSyncBootstrapOnly();
    vi.mocked(createNotification).mockRejectedValue(new Error("notifications table unreachable"));
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "CommunicationQueue" })]);
    const { processCommunicationQueue } = await import("@/server/services/communication-service");
    vi.mocked(processCommunicationQueue).mockResolvedValue({ processed: 2, sent: 2, failed: 0, expired: 0 });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
  });
});

describe("runDueTasks — existing per-task failure handling remains unchanged", () => {
  it("still records a due task's OWN failure normally (regression — unrelated to the BankSync fix)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 0, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("Rule engine exploded"));

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 0, failed: 1, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Failed", "Rule engine exploded", {});
  });

  it("a total BankSync failure (all connected accounts failed) is recorded as a real Failed run, not a silent Success (Phase 25K)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync", retryCount: 0, maxRetries: 3 })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 3, succeeded: 0, failed: 3, notPermitted: 0, notAttempted: 0, stopReason: null });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 0, failed: 1, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Failed", expect.stringContaining("BankSync failed"), {});
    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 1, expect.objectContaining({ status: "Failed", lastRunStatus: "Failed", retryCount: 1 }));
  });

  it("a total BankSync failure that exhausts its retries SUSPENDS the task and raises ONE deduplicated critical alert (migration 0099)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync", retryCount: 2, maxRetries: 3, name: "Direct bank feed sync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 0, failed: 1, notPermitted: 0, notAttempted: 0, stopReason: null });

    await runDueTasks("co_1", NOW);

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 1, expect.objectContaining({ status: "Suspended", retryCount: 3 }));
    expect(taskRepo.suspendTask).toHaveBeenCalledWith("co_1", 1, expect.stringContaining("BankSync failed"), NOW);
    expect(raiseDeduplicatedAlert).toHaveBeenCalledTimes(1);
    expect(raiseDeduplicatedAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "automation-task:1:failing", severity: "critical" }));
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ notificationType: "AutomationFailure", relatedType: "BankSync", severity: "critical" }));
    expect(createAlert).not.toHaveBeenCalled();
  });

  it("Phase 5C — a scheduled BankSync passes the request's deadline down, so its rule pass is bounded", async () => {
    // Before this it was the one unbounded posting path in the scheduler:
    // a large first sync could run past the cron's work budget and be
    // killed by the platform limit part-way through a rule pass.
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0, notPermitted: 0, notAttempted: 0, stopReason: null });

    const deadlineAtMs = Date.now() + 200_000;
    await runDueTasks("co_1", NOW, "Scheduler (cron)", { deadlineAtMs });

    expect(syncAllConnectedAccounts).toHaveBeenCalledWith("co_1", NOW, "Scheduler (cron)", { deadlineAtMs });
  });

  it("Phase 5C — the scheduler never restricts its own posting: it passes no mayPost, so the service path keeps posting", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0, notPermitted: 0, notAttempted: 0, stopReason: null });

    await runDueTasks("co_1", NOW);

    expect(vi.mocked(syncAllConnectedAccounts).mock.calls[0]![3]).not.toHaveProperty("mayPost");
  });

  it("Phase 5C — a scheduled BankSync reports exactly what its rule pass left, and why", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 2, succeeded: 2, failed: 0, notPermitted: 0, notAttempted: 9, stopReason: "time-budget" });

    await runDueTasks("co_1", NOW);

    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith(
      "co_1", expect.anything(), "Success", null,
      expect.objectContaining({ notAttempted: 9, stopReason: "time-budget", notPermitted: 0 }),
    );
  });

  it("a PARTIAL BankSync failure (at least one account succeeded) still reports overall Success (regression — unchanged behavior)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 3, succeeded: 2, failed: 1, notPermitted: 0, notAttempted: 0, stopReason: null });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 1, expect.objectContaining({ status: "Success", lastRunStatus: "Success" }));
  });

  it("still defers non-SubscriptionLifecycleSweep tasks when automation usage is exhausted (regression)", async () => {
    vi.mocked(checkUsageLimit).mockResolvedValue({ allowed: false, limit: 10, used: 10 });
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 0, succeeded: 0, failed: 0, deferred: 1 });
    expect(taskRepo.deferTask).toHaveBeenCalledWith("co_1", 1, expect.any(String));
    expect(runRuleEngine).not.toHaveBeenCalled();
  });

  it("an exhausted-retry notification failure does not abort processing of the REST of the due tasks (Phase 25I)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([
      task({ id: 1, taskType: "RuleEngineRun", retryCount: 2, maxRetries: 3 }),
      task({ id: 2, taskType: "CommunicationQueue", retryCount: 0, maxRetries: 3 }),
    ]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("Rule engine exploded"));
    vi.mocked(createNotification).mockRejectedValue(new Error("notifications table unreachable"));
    const { processCommunicationQueue } = await import("@/server/services/communication-service");
    vi.mocked(processCommunicationQueue).mockResolvedValue({ processed: 1, sent: 1, failed: 0, expired: 0 });

    const outcome = await runDueTasks("co_1", NOW);

    // Task 1 exhausts its retries (retryCount 2 -> 3 >= maxRetries 3) and
    // its own notification insert throws — this must not stop task 2
    // (a completely unrelated CommunicationQueue task) from running.
    expect(outcome).toEqual({ processed: 2, succeeded: 1, failed: 1, deferred: 0 });
    expect(processCommunicationQueue).toHaveBeenCalledWith("co_1", NOW);
  });
});

describe("runDueTasks — stale-Running crash recovery (Phase 25I)", () => {
  it("reclaims a task permanently stuck in Running (its process crashed before finishing) back to Failed, closes its open run, and respects retry/backoff", async () => {
    vi.mocked(taskRepo.listStaleRunningTasks).mockResolvedValue([task({ id: 9, taskType: "BankSync", status: "Running", retryCount: 0, maxRetries: 3 })]);
    vi.mocked(taskRepo.findOpenTaskRun).mockResolvedValue(run({ id: 55, taskId: 9, finishedAt: null }));

    await runDueTasks("co_1", NOW);

    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", 55, "Failed", expect.stringContaining("crashed"), {});
    expect(taskRepo.reclaimStaleRunningTask).toHaveBeenCalledWith("co_1", 9, expect.objectContaining({ retryCount: 1, lastRunStatus: "Failed" }));
  });

  it("reclaims a task with no open run row at all (crashed before startTaskRun even ran), without calling finishTaskRun on nothing", async () => {
    vi.mocked(taskRepo.listStaleRunningTasks).mockResolvedValue([task({ id: 10, taskType: "RuleEngineRun", status: "Running" })]);
    vi.mocked(taskRepo.findOpenTaskRun).mockResolvedValue(null);

    await runDueTasks("co_1", NOW);

    expect(taskRepo.finishTaskRun).not.toHaveBeenCalled();
    expect(taskRepo.reclaimStaleRunningTask).toHaveBeenCalledWith("co_1", 10, expect.anything());
  });

  it("a reclaimed task whose retries are exhausted is SUSPENDED with one deduplicated alert", async () => {
    vi.mocked(taskRepo.listStaleRunningTasks).mockResolvedValue([task({ id: 11, taskType: "BankSync", status: "Running", retryCount: 2, maxRetries: 3, name: "Direct bank feed sync" })]);

    await runDueTasks("co_1", NOW);

    expect(taskRepo.suspendTask).toHaveBeenCalledWith("co_1", 11, expect.stringContaining("crashed"), NOW);
    expect(raiseDeduplicatedAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "automation-task:11:failing" }));
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ notificationType: "AutomationFailure", relatedType: "BankSync" }));
    expect(createAlert).not.toHaveBeenCalled();
  });

  it("does NOT overwrite a task that finished normally a split second before the reclaim ran (atomic guard holds)", async () => {
    vi.mocked(taskRepo.listStaleRunningTasks).mockResolvedValue([task({ id: 12, taskType: "BankSync", status: "Running" })]);
    vi.mocked(taskRepo.reclaimStaleRunningTask).mockResolvedValue(false);

    await runDueTasks("co_1", NOW);

    // No exhausted-retry notification should fire for a reclaim that
    // lost the race — the task's real, legitimate outcome stands.
    expect(createNotification).not.toHaveBeenCalledWith("co_1", expect.objectContaining({ relatedType: "BankSync" }));
  });

  it("a failure inside the reclaim sweep itself does not abort the rest of the scheduler run", async () => {
    vi.mocked(taskRepo.listStaleRunningTasks).mockRejectedValue(new Error("automation_tasks unreachable"));
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 1, autoPosted: 0, exceptionsRaised: 0 }));

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ title: expect.stringContaining("stale-task recovery sweep") }));
  });
});

describe("runDueTasks — double-execution race guard (Phase 25H)", () => {
  it("skips a due task that another concurrent run already claimed, instead of executing it a second time", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(taskRepo.claimTaskForRunning).mockResolvedValue(null);

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 0, succeeded: 0, failed: 0, deferred: 0 });
    expect(runRuleEngine).not.toHaveBeenCalled();
    expect(taskRepo.startTaskRun).not.toHaveBeenCalled();
  });

  it("claims each due task before running it", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 42, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 0, autoPosted: 0, exceptionsRaised: 0 }));

    await runDueTasks("co_1", NOW);

    expect(taskRepo.claimTaskForRunning).toHaveBeenCalledWith("co_1", 42);
  });
});

describe("runTaskNow — double-execution race guard (Phase 25H)", () => {
  it("throws a clear ValidationError instead of running a task a second time when it's already claimed/running elsewhere", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType: "RuleEngineRun", status: "Running" }));
    vi.mocked(taskRepo.claimTaskForRunning).mockResolvedValue(null);

    await expect(runTaskNow("co_1", 5, NOW, "user@vyron")).rejects.toThrow(ValidationError);
    expect(runRuleEngine).not.toHaveBeenCalled();
    expect(taskRepo.startTaskRun).not.toHaveBeenCalled();
  });

  it("claims the task before running it when it's genuinely free to run", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType: "RuleEngineRun" }));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 0, autoPosted: 0, exceptionsRaised: 0 }));

    await runTaskNow("co_1", 5, NOW, "user@vyron");

    expect(taskRepo.claimTaskForRunning).toHaveBeenCalledWith("co_1", 5);
    expect(runRuleEngine).toHaveBeenCalledWith("co_1", "user@vyron", { deadlineAtMs: expect.any(Number) });
  });
});

describe("runDueTasks — tenant isolation unchanged", () => {
  it("scopes every repository call to the exact company passed in, never a different one", async () => {
    vi.mocked(taskRepo.listDueTasks).mockImplementation(async (companyId) => (companyId === "company-a" ? [task({ id: 1, taskType: "RuleEngineRun", companyId: "company-a" })] : []));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 1, autoPosted: 0, exceptionsRaised: 0 }));

    await runDueTasks("company-a", NOW);

    expect(taskRepo.listDueTasks).toHaveBeenCalledWith("company-a", NOW);
    expect(runRuleEngine).toHaveBeenCalledWith("company-a", "System", { deadlineAtMs: expect.any(Number) });
    expect(taskRepo.listAutomationTasks).toHaveBeenCalledWith("company-a");
    for (const call of vi.mocked(taskRepo.listAutomationTasks).mock.calls) expect(call[0]).toBe("company-a");
    for (const call of vi.mocked(taskRepo.createAutomationTask).mock.calls) expect(call[0]).toBe("company-a");
  });

  it("a BankSync bootstrap failure for one company never affects a separate company's run", async () => {
    vi.mocked(taskRepo.createAutomationTask).mockImplementation(async (companyId, input) => {
      if (companyId === "company-a" && input.taskType === "BankSync") throw new Error("company-a specific failure");
      return task({ id: 1, taskType: input.taskType, companyId });
    });
    vi.mocked(taskRepo.listDueTasks).mockImplementation(async (companyId) => [task({ id: 1, taskType: "RuleEngineRun", companyId })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 1, autoPosted: 0, exceptionsRaised: 0 }));

    const outcomeA = await runDueTasks("company-a", NOW);
    const outcomeB = await runDueTasks("company-b", NOW);

    expect(outcomeA).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(outcomeB).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith("company-a", expect.objectContaining({ notificationType: "AutomationFailure" }));
  });
});

// -----------------------------------------------------------------------
// Phase 26E — the AiClassificationSweep standing task. Same self-healing/
// dispatch/failure-accounting conventions as RuleEngineRun/BankSync
// above — this is the mechanism that makes existing/historical eligible
// transactions get processed without a human selecting them one at a
// time: once the standing task exists, every scheduler pass (manual "Run
// Scheduler Now", or a future unattended cron trigger) processes one
// bounded batch of whatever's currently eligible.
// -----------------------------------------------------------------------

describe("runDueTasks — AiClassificationSweep bootstrap (Phase 26E)", () => {
  it("creates the AiClassificationSweep bootstrap task, self-healing the same way RuleEngineRun/BankSync do", async () => {
    await runDueTasks("co_1", NOW);
    expect(taskRepo.createAutomationTask).toHaveBeenCalledWith("co_1", expect.objectContaining({ taskType: "AiClassificationSweep", name: "AI Classification sweep" }));
  });

  it("does not create a second AiClassificationSweep task when one already exists", async () => {
    vi.mocked(taskRepo.listAutomationTasks).mockResolvedValue([task({ id: 6, taskType: "AiClassificationSweep" })]);
    await runDueTasks("co_1", NOW);
    expect(taskRepo.createAutomationTask).not.toHaveBeenCalledWith("co_1", expect.objectContaining({ taskType: "AiClassificationSweep" }));
  });

  it("a bootstrap failure does not stop the scheduler from processing other due task types", async () => {
    vi.mocked(taskRepo.createAutomationTask).mockImplementation(async (companyId, input) => {
      if (input.taskType === "AiClassificationSweep") throw new Error("automation_tasks insert failed");
      return task({ id: 1, taskType: input.taskType, companyId });
    });
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 1, autoPosted: 0, exceptionsRaised: 0 }));

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
  });
});

describe("runDueTasks — AiClassificationSweep dispatch (Phase 26E)", () => {
  it("calls the shared classification sweep and reports Success with its outcome as the run summary", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 20, classified: 12, autoAllocated: 5, noConfidentSuggestion: 3, failed: 0, rateLimited: 0, hasMoreEligible: true });

    const outcome = await runDueTasks("co_1", NOW);

    expect(runAutomaticAiClassificationSweep).toHaveBeenCalledWith("co_1", "System", { taskRunId: 1, nowIso: NOW });
    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Success", null, expect.objectContaining({ attempted: 20, autoAllocated: 5 }));
  });

  it("reschedules SOON (not the normal hourly cadence) when hasMoreEligible is true — draining a historical backlog across a few passes, not one pass per hour", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 20, classified: 20, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: true });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBeLessThan(60 * 60_000);
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBeGreaterThan(0);
  });

  it("falls back to the normal hourly cadence once caught up (hasMoreEligible: false, no rate limit)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 3, classified: 3, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(60 * 60_000);
  });

  it("reschedules soon when the sweep hit a rate limit, so the next pass backs off instead of hammering the provider immediately", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 5, classified: 5, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBeLessThan(60 * 60_000);
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBeGreaterThan(0);
  });

  // Phase 26I — honor the provider's own stated `Retry-After` cooldown
  // (surfaced via `AIProviderError.retryAfterMs` -> the sweep's
  // `retryAfterMs` summary field) instead of always paying the flat
  // 5-minute wait regardless of what the provider actually asked for.
  it("reschedules using the provider's own stated retryAfterMs when it is shorter than the flat 5-minute default", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 6, classified: 0, autoAllocated: 5, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: true, retryAfterMs: 20_000 });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(20_000);
  });

  it("never reschedules faster than the 15-second safety floor even if retryAfterMs is implausibly small", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false, retryAfterMs: 1_000 });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(15_000);
  });

  it("never reschedules slower than the existing flat 5-minute ceiling even if retryAfterMs is implausibly large", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false, retryAfterMs: 60 * 60_000 });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(5 * 60_000);
  });

  it("falls back to the flat 5-minute default when rate-limited but retryAfterMs is absent (provider gave no header)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(5 * 60_000);
  });

  it("an INFRASTRUCTURE failure (safety store unavailable / every database read failed) fails the run, so scheduler retries -> Suspended apply", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep", retryCount: 0, maxRetries: 3 })]);
    mockSweep({ attempted: 0, stoppedReason: "safety_unavailable", infrastructureFailure: true, providerMessage: "AI classification safety store is not configured" });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 0, failed: 1, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Failed", expect.stringContaining("could not run safely (safety_unavailable)"), {});
  });

  it("a PROVIDER failure is not a task failure: the run succeeds, the batch stopped, and ONE deduplicated provider alert is raised", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 1, failed: 1, providerFailures: 1, providerRequests: 1, stoppedReason: "provider_failure", errorCategory: "unauthorized", httpStatus: 401, providerMessage: "Unauthorized", circuitState: "open", hasMoreEligible: true });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(raiseDeduplicatedAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "ai-classification:provider-unavailable", severity: "critical", message: expect.stringContaining("HTTP 401") }));
    expect(createNotification).toHaveBeenCalledTimes(1);
    // No progress -> the normal hour, never 2 minutes.
    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    expect(Date.parse((call?.[2] as { nextRunAt: string }).nextRunAt) - Date.parse(NOW)).toBe(60 * 60_000);
  });

  it("a batch with only noConfidentSuggestion/rateLimited outcomes (no `failed`) is still a healthy Success, never treated as an outage", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    mockSweep({ attempted: 2, classified: 0, autoAllocated: 0, noConfidentSuggestion: 1, failed: 0, rateLimited: 1, hasMoreEligible: false });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
  });

  it("an empty batch (nothing currently eligible) is a trivial Success, exactly like BankSync with no connected accounts", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
  });

  it("is subject to the same automation usage-limit deferral as every other non-SubscriptionLifecycleSweep task type", async () => {
    vi.mocked(checkUsageLimit).mockResolvedValue({ allowed: false, limit: 10, used: 10 });
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 0, succeeded: 0, failed: 0, deferred: 1 });
    expect(runAutomaticAiClassificationSweep).not.toHaveBeenCalled();
  });

  it("tenant isolation — scopes the sweep to the exact company the scheduler run was called for", async () => {
    vi.mocked(taskRepo.listDueTasks).mockImplementation(async (companyId) => (companyId === "company-a" ? [task({ id: 1, taskType: "AiClassificationSweep", companyId: "company-a" })] : []));

    await runDueTasks("company-a", NOW);
    await runDueTasks("company-b", NOW);

    expect(runAutomaticAiClassificationSweep).toHaveBeenCalledTimes(1);
    expect(runAutomaticAiClassificationSweep).toHaveBeenCalledWith("company-a", "System", expect.objectContaining({ nowIso: NOW }));
  });
});

// -----------------------------------------------------------------------
// Migration 0099 — AI safety: cadence, suspension, alert deduplication.
// -----------------------------------------------------------------------

describe("AI sweep cadence (migration 0099)", () => {
  const sweepTask = task({ id: 6, taskType: "AiClassificationSweep" });

  it("P. no progress (no-confidence answers only) + more eligible -> the normal hour, NOT 2 minutes", () => {
    const next = nextTaskRunAt(sweepTask, NOW, sweepOutcome({ attempted: 20, noConfidentSuggestion: 20, providerRequests: 20, hasMoreEligible: true }));
    expect(Date.parse(next) - Date.parse(NOW)).toBe(60 * 60_000);
  });

  it("Q. real progress (a suggestion saved) + more eligible -> the controlled 2-minute reschedule", () => {
    const next = nextTaskRunAt(sweepTask, NOW, sweepOutcome({ attempted: 20, classified: 1, noConfidentSuggestion: 19, hasMoreEligible: true }));
    expect(Date.parse(next) - Date.parse(NOW)).toBe(2 * 60_000);
  });

  it("progress but nothing more eligible -> the normal hour", () => {
    const next = nextTaskRunAt(sweepTask, NOW, sweepOutcome({ attempted: 3, classified: 3, hasMoreEligible: false }));
    expect(Date.parse(next) - Date.parse(NOW)).toBe(60 * 60_000);
  });

  it("an open circuit or the daily cap never shortens the cadence", () => {
    for (const stoppedReason of ["circuit_open", "daily_cap"] as const) {
      const next = nextTaskRunAt(sweepTask, NOW, sweepOutcome({ stoppedReason, hasMoreEligible: true }));
      expect(Date.parse(next) - Date.parse(NOW)).toBe(60 * 60_000);
    }
  });
});

describe("task failure handling — Suspended + deduplicated alerts (migration 0099)", () => {
  it("R. a first failure retries in 5 minutes with a warning notification and NO alert", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 0, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("db timeout"));

    await runDueTasks("co_1", NOW);

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 1, expect.objectContaining({ status: "Failed", retryCount: 1 }));
    expect(taskRepo.suspendTask).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ severity: "warning", title: expect.stringContaining("retrying") }));
    expect(raiseDeduplicatedAlert).not.toHaveBeenCalled();
  });

  it("a second (non-exhausting) failure sends nothing new — no hourly notification spam", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 1, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("db timeout"));

    await runDueTasks("co_1", NOW);

    expect(createNotification).not.toHaveBeenCalled();
    expect(raiseDeduplicatedAlert).not.toHaveBeenCalled();
  });

  it("R. retries exhausted -> Suspended (listDueTasks never selects it) with a critical alert", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 2, maxRetries: 3, name: "Banking Rules recovery sweep" })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("db timeout"));

    await runDueTasks("co_1", NOW);

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 1, expect.objectContaining({ status: "Suspended" }));
    expect(taskRepo.suspendTask).toHaveBeenCalledWith("co_1", 1, "db timeout", NOW);
    expect(raiseDeduplicatedAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "automation-task:1:failing", title: expect.stringContaining("suspended") }));
  });

  it("S. a repeat of the same failure updates the existing alert (not created) and sends NO new notification", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 2, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("db timeout"));
    vi.mocked(raiseDeduplicatedAlert).mockResolvedValue({ alertId: 900, created: false, occurrenceCount: 2 });

    await runDueTasks("co_1", NOW);

    expect(raiseDeduplicatedAlert).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(createAlert).not.toHaveBeenCalled();
  });

  it("S. escalation: the 24th occurrence of the same alert sends one escalation notification", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 2, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("db timeout"));
    vi.mocked(raiseDeduplicatedAlert).mockResolvedValue({ alertId: 900, created: false, occurrenceCount: 24 });

    await runDueTasks("co_1", NOW);

    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ title: expect.stringContaining("still failing") }));
  });

  it("recovery: a success after failures resolves the task's alert and sends one recovery notification", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 2, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 1, autoPosted: 0, exceptionsRaised: 0 }));
    vi.mocked(resolveDeduplicatedAlert).mockResolvedValue(1);

    await runDueTasks("co_1", NOW);

    expect(resolveDeduplicatedAlert).toHaveBeenCalledWith("co_1", "automation-task:1:failing", "Automation Scheduler", NOW);
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ severity: "info", title: expect.stringContaining("recovered") }));
  });

  it("an ordinary success (never failing) does not touch alerts at all", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun", retryCount: 0 })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 1, autoPosted: 0, exceptionsRaised: 0 }));

    await runDueTasks("co_1", NOW);

    expect(resolveDeduplicatedAlert).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("resuming a task gives it a fresh retry budget and clears the suspension — never automatic", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 6, taskType: "AiClassificationSweep", status: "Suspended", retryCount: 3 }));
    await resumeTask("co_1", 6);
    expect(taskRepo.resumeAutomationTask).toHaveBeenCalledWith("co_1", 6);
    expect(taskRepo.setTaskStatus).not.toHaveBeenCalled();
  });
});

describe("AI sweep alerts (migration 0099)", () => {
  beforeEach(() => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 6, taskType: "AiClassificationSweep" })]);
  });

  it("an open circuit raises the provider alert once; a repeat updates it without a new notification", async () => {
    mockSweep({ stoppedReason: "circuit_open", circuitState: "open" });
    await runDueTasks("co_1", NOW);
    vi.mocked(raiseDeduplicatedAlert).mockResolvedValue({ alertId: 900, created: false, occurrenceCount: 2 });
    await runDueTasks("co_1", NOW);

    expect(raiseDeduplicatedAlert).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createNotification).mock.calls.filter((c) => (c[1] as { relatedType: string }).relatedType === "AiClassificationSweep")).toHaveLength(1);
  });

  it("the daily safety cap raises ONE warning alert, not one per blocked transaction", async () => {
    mockSweep({ stoppedReason: "daily_cap", requestsToday: 100, dailyCap: 100, hasMoreEligible: true });
    await runDueTasks("co_1", NOW);

    expect(raiseDeduplicatedAlert).toHaveBeenCalledTimes(1);
    expect(raiseDeduplicatedAlert).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "ai-classification:daily-cap", severity: "warning" }));
  });

  it("a normal answer from the provider resolves the provider alert (recovery)", async () => {
    mockSweep({ attempted: 2, providerRequests: 2, noConfidentSuggestion: 2 });
    vi.mocked(resolveDeduplicatedAlert).mockResolvedValue(1);
    await runDueTasks("co_1", NOW);

    expect(resolveDeduplicatedAlert).toHaveBeenCalledWith("co_1", "ai-classification:provider-unavailable", "AI Classification", NOW);
    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ title: "AI classification provider recovered" }));
  });
});

// -----------------------------------------------------------------------
// Pre-deployment review — Run Now and stopped tasks; sanitized sweep errors.
// -----------------------------------------------------------------------

describe("Review — Run Now never re-activates a paused task", () => {
  // Phase 5D — Disabled and Suspended are no longer runnable at all (the
  // Run Now state-machine suite below covers them), so only Paused, which
  // remains deliberately runnable, reaches this behaviour.
  it("a successful manual run of a Paused task keeps its status and retry count, and sends no 'recovered' notice", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 6, taskType: "AiClassificationSweep", status: "Paused", retryCount: 3, isActive: false }));

    await runTaskNow("co_1", 6, NOW, "user@vyron");

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 6, expect.objectContaining({ status: "Paused", retryCount: 3 }));
    expect(resolveDeduplicatedAlert).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("a failed manual run of a Paused task keeps its status", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 6, taskType: "AiClassificationSweep", status: "Paused", retryCount: 3, isActive: false }));
    vi.mocked(runAutomaticAiClassificationSweep).mockRejectedValue(new Error("database unreachable"));

    await expect(runTaskNow("co_1", 6, NOW, "user@vyron")).rejects.toThrow(ValidationError);

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 6, expect.objectContaining({ status: "Paused" }));
  });

  it("a manual run of the AI sweep goes through the same sweep (and therefore the same gate, circuit and fuse)", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 6, taskType: "AiClassificationSweep", status: "Paused", isActive: false }));

    await runTaskNow("co_1", 6, NOW, "user@vyron");

    expect(runAutomaticAiClassificationSweep).toHaveBeenCalledWith("co_1", "user@vyron", expect.objectContaining({ nowIso: NOW }));
  });

  it("an ordinary (Queued) task still records Success after a manual run", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType: "RuleEngineRun" }));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 0, autoPosted: 0, exceptionsRaised: 0 }));

    await runTaskNow("co_1", 5, NOW, "user@vyron");

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 5, expect.objectContaining({ status: "Success", retryCount: 0 }));
  });
});

// -----------------------------------------------------------------------
// Phase 5D — the Run Now state machine and its posting-permission gate.
// -----------------------------------------------------------------------

describe("Phase 5D — Run Now task-state machine", () => {
  /** Nothing about the task changed, and nothing ran. This is the real
   * assertion behind every refusal: a refused Run Now must leave no
   * claim, no run row, no status change — and no accounting write. */
  function expectNothingHappened() {
    expect(taskRepo.claimTaskForRunning).not.toHaveBeenCalled();
    expect(taskRepo.startTaskRun).not.toHaveBeenCalled();
    expect(taskRepo.recordTaskOutcome).not.toHaveBeenCalled();
    expect(taskRepo.finishTaskRun).not.toHaveBeenCalled();
    expect(runRuleEngine).not.toHaveBeenCalled();
    expect(syncAllConnectedAccounts).not.toHaveBeenCalled();
    expect(runAutomaticAiClassificationSweep).not.toHaveBeenCalled();
  }

  it.each(["RuleEngineRun", "BankSync", "AiClassificationSweep", "CommunicationQueue"] as const)(
    "REFUSES a Suspended %s task, whatever its type, with the exact message",
    async (taskType) => {
      vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 7, taskType, status: "Suspended" }));

      await expect(runTaskNow("co_1", 7, NOW, "user@vyron", { mayPost: true })).rejects.toThrow(
        "This task is suspended and must be resumed before it can be run.",
      );
      expectNothingHappened();
    },
  );

  it("REFUSES a Suspended Rule Engine task even with Banking:Post — the posting permission is not an override", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 7, taskType: "RuleEngineRun", status: "Suspended" }));

    await expect(runTaskNow("co_1", 7, NOW, "user@vyron", { mayPost: true })).rejects.toThrow(/suspended and must be resumed/);
    expectNothingHappened();
  });

  it.each(["RuleEngineRun", "BankSync", "AiClassificationSweep"] as const)("REFUSES a Disabled %s task with the exact message", async (taskType) => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 8, taskType, status: "Disabled" }));

    await expect(runTaskNow("co_1", 8, NOW, "user@vyron", { mayPost: true })).rejects.toThrow(
      "This task is disabled and must be resumed before it can be run.",
    );
    expectNothingHappened();
  });

  it("ALLOWS a Paused Rule Engine task with Banking:Post — controlled manual testing is preserved", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType: "RuleEngineRun", status: "Paused", isActive: false }));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());

    await runTaskNow("co_1", 5, NOW, "user@vyron", { mayPost: true });

    expect(runRuleEngine).toHaveBeenCalled();
    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 5, expect.objectContaining({ status: "Paused" }));
  });

  it("ALLOWS an Active (Queued) Rule Engine task with Banking:Post", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType: "RuleEngineRun" }));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());

    await runTaskNow("co_1", 5, NOW, "user@vyron", { mayPost: true });

    expect(runRuleEngine).toHaveBeenCalled();
  });

  it("refuses before the claim, so a refused run cannot even lose a race to a real one", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 7, taskType: "RuleEngineRun", status: "Suspended" }));

    await expect(runTaskNow("co_1", 7, NOW, "user@vyron")).rejects.toThrow(ValidationError);

    expect(taskRepo.claimTaskForRunning).not.toHaveBeenCalled();
  });

  it("tenant isolation: it reads, and refuses, strictly within the company it was given", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 7, taskType: "RuleEngineRun", status: "Suspended", companyId: "co_2" }));

    await expect(runTaskNow("co_2", 7, NOW, "user@vyron")).rejects.toThrow(ValidationError);

    expect(taskRepo.getAutomationTask).toHaveBeenCalledWith("co_2", 7);
    expectNothingHappened();
  });
});

describe("Phase 5D — Run Now posting-permission gate", () => {
  it.each(["RuleEngineRun", "BankSync"] as const)("%s posts, so it is refused without Banking:Post and nothing runs", async (taskType) => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType }));

    await expect(runTaskNow("co_1", 5, NOW, "user@vyron", { mayPost: false })).rejects.toThrow(/"Banking:Post" permission/);

    expect(runRuleEngine).not.toHaveBeenCalled();
    expect(syncAllConnectedAccounts).not.toHaveBeenCalled();
    expect(taskRepo.claimTaskForRunning).not.toHaveBeenCalled();
  });

  it.each(["RuleEngineRun", "BankSync"] as const)("%s runs with Banking:Post", async (taskType) => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType }));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0, notPermitted: 0, notAttempted: 0, stopReason: null });

    await runTaskNow("co_1", 5, NOW, "user@vyron", { mayPost: true });

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 5, expect.objectContaining({ status: "Success" }));
  });

  it.each(["AiClassificationSweep", "CommunicationQueue", "SubscriptionLifecycleSweep"] as const)(
    "%s posts nothing, so it does NOT require Banking:Post",
    async (taskType) => {
      vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 6, taskType }));

      await runTaskNow("co_1", 6, NOW, "user@vyron", { mayPost: false });

      expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 6, expect.objectContaining({ status: "Success" }));
    },
  );

  it("taskPostsAccounting classifies every task type in the registry, explicitly", () => {
    // Phase 5E — RecurringTemplate was corrected to `true`: a Journal
    // template writes an Approved journal then calls postApprovedJournals,
    // and CustomerInvoice/SupplierBill templates approve-and-post. It
    // posts through the sales/purchasing/GL modules rather than the
    // banking ones, which is why a from-memory list missed it in 5D.
    expect(taskPostsAccounting("RuleEngineRun")).toBe(true);
    expect(taskPostsAccounting("BankSync")).toBe(true);
    expect(taskPostsAccounting("RecurringTemplate")).toBe(true);

    for (const t of ["AiClassificationSweep", "CommunicationQueue", "SubscriptionLifecycleSweep", "ReportRefresh", "Custom"] as const) {
      expect(taskPostsAccounting(t)).toBe(false);
    }
  });

  it("every task type in the registry is classified — none falls through", () => {
    // `taskPostsAccounting` is an exhaustive switch, so adding a task type
    // stops it compiling; this pins the runtime answer for the registry
    // as it stands, and names the complete posting set in one place.
    const allTaskTypes: AutomationTaskType[] = [
      "RecurringTemplate", "RuleEngineRun", "ReportRefresh", "CommunicationQueue",
      "Custom", "SubscriptionLifecycleSweep", "BankSync", "AiClassificationSweep",
    ];
    for (const t of allTaskTypes) expect(typeof taskPostsAccounting(t)).toBe("boolean");
    expect(allTaskTypes.filter(taskPostsAccounting).sort()).toEqual(["BankSync", "RecurringTemplate", "RuleEngineRun"]);
  });

  it("omitting mayPost permits posting — internal/service callers are unaffected", async () => {
    vi.mocked(taskRepo.getAutomationTask).mockResolvedValue(task({ id: 5, taskType: "RuleEngineRun" }));
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());

    await runTaskNow("co_1", 5, NOW, "user@vyron");

    expect(runRuleEngine).toHaveBeenCalled();
  });
});

describe("Phase 5D — the scheduled (service-role) path is untouched by the Run Now gates", () => {
  it("a due Rule Engine task still runs through runDueTasks with no permission answer at all", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());

    const outcome = await runDueTasks("co_1", NOW, "Scheduler (cron)");

    expect(outcome).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(runRuleEngine).toHaveBeenCalled();
  });

  it("a due BankSync task still runs through runDueTasks", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0, notPermitted: 0, notAttempted: 0, stopReason: null });

    const outcome = await runDueTasks("co_1", NOW, "Scheduler (cron)");

    expect(outcome).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(syncAllConnectedAccounts).toHaveBeenCalled();
  });

  it("the scheduler still cannot reach a Suspended or Paused task — listDueTasks is what excludes them, unchanged", async () => {
    // `listDueTasks` is the repository's own WHERE clause; the Run Now
    // state machine is a separate gate and must not have altered this.
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([]);

    const outcome = await runDueTasks("co_1", NOW, "Scheduler (cron)");

    expect(outcome).toMatchObject({ processed: 0, succeeded: 0, failed: 0 });
    expect(runRuleEngine).not.toHaveBeenCalled();
  });
});

describe("Review — task retries are consumed only by infrastructure failures", () => {
  it.each([
    ["provider failure", { attempted: 1, failed: 1, providerFailures: 1, providerRequests: 1, stoppedReason: "provider_failure" as const, circuitState: "open" as const }],
    ["open circuit", { stoppedReason: "circuit_open" as const, circuitState: "open" as const }],
    ["daily fuse", { stoppedReason: "daily_cap" as const, requestsToday: 100 }],
    ["rate limit", { attempted: 1, rateLimited: 1, providerRequests: 1, stoppedReason: "rate_limited" as const, retryAfterMs: 20_000 }],
    ["no-confidence answers", { attempted: 20, noConfidentSuggestion: 20, providerRequests: 20 }],
  ])("a %s is a successful run: retry count reset, never Suspended", async (_label, overrides) => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 6, taskType: "AiClassificationSweep", retryCount: 2, maxRetries: 3 })]);
    mockSweep(overrides);

    await runDueTasks("co_1", NOW);

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 6, expect.objectContaining({ status: "Success", retryCount: 0 }));
    expect(taskRepo.suspendTask).not.toHaveBeenCalled();
  });
});

describe("Review — sweep infrastructure errors are sanitized before they are stored", () => {
  it("a queue-read failure is stored in the run (and any suspension/alert) without credentials", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 6, taskType: "AiClassificationSweep", retryCount: 2, maxRetries: 3 })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockRejectedValue(new Error("connect failed postgres://svc:hunter2pass@db.example:5432/postgres token=abc123def456"));

    await runDueTasks("co_1", NOW);

    const failedRun = vi.mocked(taskRepo.finishTaskRun).mock.calls.find((c) => c[2] === "Failed");
    const message = String(failedRun?.[3]);
    expect(message).toContain("could not read its queue");
    expect(message).not.toContain("hunter2pass");
    expect(message).not.toContain("abc123def456");
    const reason = String(vi.mocked(taskRepo.suspendTask).mock.calls[0]?.[2]);
    expect(reason).not.toContain("hunter2pass");
    expect(JSON.stringify(vi.mocked(raiseDeduplicatedAlert).mock.calls)).not.toContain("hunter2pass");
  });
});

describe("Migration 0100 — the Banking Rules sweep is bounded by time", () => {
  it("J. passes the request deadline down, capped by the sweep's own budget", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 10, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());
    const requestDeadline = Date.now() + 10_000;

    await runDueTasks("co_1", NOW, "Scheduler (cron)", { deadlineAtMs: requestDeadline });

    const passed = vi.mocked(runRuleEngine).mock.calls[0]?.[2]?.deadlineAtMs;
    expect(passed).toBe(requestDeadline);
  });

  it("J. without a request deadline the sweep still gets a finite budget well inside the platform limit", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 10, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());
    const before = Date.now();

    await runDueTasks("co_1", NOW);

    const passed = vi.mocked(runRuleEngine).mock.calls[0]?.[2]?.deadlineAtMs ?? Infinity;
    expect(passed - before).toBeLessThanOrEqual(RULE_ENGINE_TASK_BUDGET_MS + 1_000);
    expect(RULE_ENGINE_TASK_BUDGET_MS).toBeLessThan(300_000);
  });

  it("J. does not start (or claim) any task once the request deadline has passed — they stay due for the next pass", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 10, taskType: "RuleEngineRun" }), task({ id: 11, taskType: "CommunicationQueue" })]);

    const outcome = await runDueTasks("co_1", NOW, "Scheduler (cron)", { deadlineAtMs: Date.now() - 1 });

    expect(outcome).toEqual({ processed: 0, succeeded: 0, failed: 0, deferred: 0, postponed: 2 });
    expect(taskRepo.claimTaskForRunning).not.toHaveBeenCalled();
    expect(runRuleEngine).not.toHaveBeenCalled();
    expect(taskRepo.deferTask).not.toHaveBeenCalled();
  });

  it("records the sweep's progress (remaining, stoppedEarly, recovered) in the run summary", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 10, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome({ processed: 40, autoPosted: 38, recovered: 1, postingAttempts: 39, awaitingReview: 562, remaining: 200, stoppedEarly: true, stopReason: "time-budget", intelligenceSkipped: true }));

    await runDueTasks("co_1", NOW);

    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith(
      "co_1",
      expect.any(Number),
      "Success",
      null,
      expect.objectContaining({ processed: 40, autoPosted: 38, recovered: 1, postingAttempts: 39, awaitingReview: 562, remaining: 200, stoppedEarly: true, stopReason: "time-budget", intelligenceSkipped: true }),
    );
  });

  it("a sweep that failed outright goes through the normal retry/suspend path", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 10, taskType: "RuleEngineRun", retryCount: 2, maxRetries: 3 })]);
    vi.mocked(runRuleEngine).mockRejectedValue(new Error("Banking Rules could not post any transaction (3 failed): database unavailable"));

    await runDueTasks("co_1", NOW);

    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 10, expect.objectContaining({ status: "Suspended", retryCount: 3 }));
  });
});

describe("Migration 0100 — nextTaskRunAt for the Banking Rules sweep", () => {
  const RULE_TASK = task({ id: 10, taskType: "RuleEngineRun" });
  const minutesAfter = (iso: string) => (Date.parse(iso) - Date.parse(NOW)) / 60_000;

  it("comes back in 5 minutes when it stopped early while still making progress", () => {
    expect(minutesAfter(nextTaskRunAt(RULE_TASK, NOW, { stoppedEarly: true, autoPosted: 5, recovered: 0 }))).toBe(5);
    expect(minutesAfter(nextTaskRunAt(RULE_TASK, NOW, { stoppedEarly: true, autoPosted: 0, recovered: 1 }))).toBe(5);
  });

  it("waits the normal hour when it finished, made no progress, or has no summary", () => {
    expect(minutesAfter(nextTaskRunAt(RULE_TASK, NOW, { stoppedEarly: false, autoPosted: 5 }))).toBe(60);
    expect(minutesAfter(nextTaskRunAt(RULE_TASK, NOW, { stoppedEarly: true, autoPosted: 0, recovered: 0 }))).toBe(60);
    expect(minutesAfter(nextTaskRunAt(RULE_TASK, NOW))).toBe(60);
  });
});

// -----------------------------------------------------------------------
// Phase 5E — "Run Scheduler Now": the queue runs, posting tasks are
// refused for a caller without Banking:Post, and nothing is silent.
// -----------------------------------------------------------------------

describe("Phase 5E — Run Scheduler Now posting-permission gate", () => {
  it.each(["RuleEngineRun", "BankSync", "RecurringTemplate"] as const)(
    "a due %s task is NOT run without Banking:Post, and is left untouched and still due",
    async (taskType) => {
      vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType, name: `${taskType} task` })]);

      const outcome = await runDueTasks("co_1", NOW, "user@vyron", { mayPost: false });

      expect(outcome).toMatchObject({ processed: 0, succeeded: 0, failed: 0, refused: 1 });
      expect(outcome.refusedTasks).toEqual([
        expect.objectContaining({ taskId: 1, taskType, reason: expect.stringContaining("Banking:Post") }),
      ]);
      // Untouched: never claimed, never started, no outcome recorded, so
      // next_run_at is unchanged and it is still due for the cron pass.
      expect(taskRepo.claimTaskForRunning).not.toHaveBeenCalled();
      expect(taskRepo.startTaskRun).not.toHaveBeenCalled();
      expect(taskRepo.recordTaskOutcome).not.toHaveBeenCalled();
      expect(taskRepo.deferTask).not.toHaveBeenCalled();
      // And no accounting side effect of any kind.
      expect(runRuleEngine).not.toHaveBeenCalled();
      expect(syncAllConnectedAccounts).not.toHaveBeenCalled();
      expect(generateFromTemplate).not.toHaveBeenCalled();
    },
  );

  it.each(["RuleEngineRun", "BankSync"] as const)("a due %s task IS run with Banking:Post", async (taskType) => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType })]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 1, failed: 0, notPermitted: 0, notAttempted: 0, stopReason: null });

    const outcome = await runDueTasks("co_1", NOW, "user@vyron", { mayPost: true });

    expect(outcome).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(outcome.refused).toBeUndefined();
    expect(outcome.refusedTasks).toBeUndefined();
  });

  it.each(["AiClassificationSweep", "CommunicationQueue", "SubscriptionLifecycleSweep"] as const)(
    "a due non-posting %s task runs even without Banking:Post",
    async (taskType) => {
      vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType })]);

      const outcome = await runDueTasks("co_1", NOW, "user@vyron", { mayPost: false });

      expect(outcome).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
      expect(outcome.refused).toBeUndefined();
    },
  );

  it("MIXED QUEUE: the non-posting task runs, the posting task does not, and the result says which", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([
      task({ id: 1, taskType: "CommunicationQueue", name: "Comms queue" }),
      task({ id: 2, taskType: "RuleEngineRun", name: "Banking Rules recovery sweep" }),
      task({ id: 3, taskType: "AiClassificationSweep", name: "AI sweep" }),
    ]);

    const outcome = await runDueTasks("co_1", NOW, "user@vyron", { mayPost: false });

    // Two non-posting tasks ran; the Rule Engine task did not.
    expect(outcome).toMatchObject({ processed: 2, succeeded: 2, failed: 0, refused: 1 });
    expect(outcome.refusedTasks).toEqual([
      expect.objectContaining({ taskId: 2, taskType: "RuleEngineRun", name: "Banking Rules recovery sweep" }),
    ]);
    expect(runRuleEngine).not.toHaveBeenCalled();
    // The tasks that DID run were claimed; the refused one never was.
    expect(vi.mocked(taskRepo.claimTaskForRunning).mock.calls.map((c) => c[1])).toEqual([1, 3]);
  });

  it("a refused task produces no journal, no ledger row, no posting batch and no success claim", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 2, taskType: "RuleEngineRun" })]);

    const outcome = await runDueTasks("co_1", NOW, "user@vyron", { mayPost: false });

    expect(runRuleEngine).not.toHaveBeenCalled();
    expect(taskRepo.finishTaskRun).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
    expect(outcome.succeeded).toBe(0);
  });

  it("omitting mayPost runs everything — the cron path's behaviour is byte-for-byte unchanged", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([
      task({ id: 1, taskType: "RuleEngineRun" }),
      task({ id: 2, taskType: "CommunicationQueue" }),
    ]);
    vi.mocked(runRuleEngine).mockResolvedValue(ruleEngineOutcome());

    const outcome = await runDueTasks("co_1", NOW, "Scheduler (cron)");

    expect(outcome).toEqual({ processed: 2, succeeded: 2, failed: 0, deferred: 0 });
    expect(runRuleEngine).toHaveBeenCalled();
  });

  it("tenant isolation: the refusal is scoped to the company asked about", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 2, taskType: "RuleEngineRun", companyId: "co_2" })]);

    const outcome = await runDueTasks("co_2", NOW, "user@vyron", { mayPost: false });

    expect(taskRepo.listDueTasks).toHaveBeenCalledWith("co_2", NOW);
    expect(outcome.refused).toBe(1);
    expect(runRuleEngine).not.toHaveBeenCalled();
  });

  it("the refusal is decided by the central predicate, not a local string list", async () => {
    // Every posting task type the predicate names must be refused here.
    const posting = (["RecurringTemplate", "RuleEngineRun", "ReportRefresh", "CommunicationQueue", "Custom", "SubscriptionLifecycleSweep", "BankSync", "AiClassificationSweep"] as AutomationTaskType[]).filter(taskPostsAccounting);
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue(posting.map((taskType, i) => task({ id: i + 1, taskType })));

    const outcome = await runDueTasks("co_1", NOW, "user@vyron", { mayPost: false });

    expect(outcome.refused).toBe(posting.length);
    expect(outcome.refusedTasks?.map((t) => t.taskType).sort()).toEqual([...posting].sort());
  });
});
