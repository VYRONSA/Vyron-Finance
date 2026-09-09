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
}));
vi.mock("@/server/repositories/recurring-template-repository", () => ({ listRecurringTemplates: vi.fn(), getRecurringTemplate: vi.fn() }));
vi.mock("@/server/services/recurring-template-service", () => ({ generateFromTemplate: vi.fn() }));
vi.mock("@/server/services/rule-processing-service", () => ({ runRuleEngine: vi.fn() }));
vi.mock("@/server/services/communication-service", () => ({ processCommunicationQueue: vi.fn() }));
vi.mock("@/server/services/notification-service", () => ({ createNotification: vi.fn() }));
vi.mock("@/server/services/operations-service", () => ({ createAlert: vi.fn() }));
vi.mock("@/server/billing-platform/engine/lifecycle-sweep-engine", () => ({ runSubscriptionLifecycleSweep: vi.fn() }));
vi.mock("@/server/bank-connectivity/bank-sync-service", () => ({ syncAllConnectedAccounts: vi.fn() }));
vi.mock("@/server/services/transaction-classification-service", () => ({ runAutomaticAiClassificationSweep: vi.fn() }));
vi.mock("@/server/billing-platform/engine/feature-flag-engine", () => ({ hasFeature: vi.fn() }));
vi.mock("@/server/billing-platform/engine/licensing-engine", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));

import { runDueTasks, runTaskNow, ValidationError } from "./scheduler-service";
import * as taskRepo from "@/server/repositories/automation-task-repository";
import * as templateRepo from "@/server/repositories/recurring-template-repository";
import { runRuleEngine } from "@/server/services/rule-processing-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { syncAllConnectedAccounts } from "@/server/bank-connectivity/bank-sync-service";
import { runAutomaticAiClassificationSweep } from "@/server/services/transaction-classification-service";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

const NOW = "2026-08-12T10:00:00.000Z";

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
  vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false });
});

describe("runDueTasks — BankSync bootstrap succeeds (existing behavior unchanged)", () => {
  it("creates the BankSync bootstrap task and still processes a due RecurringTemplate-independent task normally", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "RuleEngineRun" })]);
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 5, autoPosted: 2, exceptionsRaised: 1, results: [] });

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
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 3, autoPosted: 1, exceptionsRaised: 0, results: [] });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(runRuleEngine).toHaveBeenCalledWith("co_1", "System");
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
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 3, succeeded: 0, failed: 3 });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 0, failed: 1, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Failed", expect.stringContaining("BankSync failed"), {});
    expect(taskRepo.recordTaskOutcome).toHaveBeenCalledWith("co_1", 1, expect.objectContaining({ status: "Failed", lastRunStatus: "Failed", retryCount: 1 }));
  });

  it("a total BankSync failure fires the exhausted-retry notification/alert once retries run out (Phase 25K)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync", retryCount: 2, maxRetries: 3, name: "Direct bank feed sync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 1, succeeded: 0, failed: 1 });

    await runDueTasks("co_1", NOW);

    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ notificationType: "AutomationFailure", relatedType: "BankSync" }));
    expect(createAlert).toHaveBeenCalledTimes(1);
  });

  it("a PARTIAL BankSync failure (at least one account succeeded) still reports overall Success (regression — unchanged behavior)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "BankSync" })]);
    vi.mocked(syncAllConnectedAccounts).mockResolvedValue({ attempted: 3, succeeded: 2, failed: 1 });

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

  it("fires the exhausted-retry notification/alert once a reclaimed task's retries are exhausted", async () => {
    vi.mocked(taskRepo.listStaleRunningTasks).mockResolvedValue([task({ id: 11, taskType: "BankSync", status: "Running", retryCount: 2, maxRetries: 3, name: "Direct bank feed sync" })]);

    await runDueTasks("co_1", NOW);

    expect(createNotification).toHaveBeenCalledWith("co_1", expect.objectContaining({ notificationType: "AutomationFailure", relatedType: "BankSync" }));
    expect(createAlert).toHaveBeenCalledTimes(1);
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
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 1, autoPosted: 0, exceptionsRaised: 0, results: [] });

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
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 0, autoPosted: 0, exceptionsRaised: 0, results: [] });

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
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 0, autoPosted: 0, exceptionsRaised: 0, results: [] });

    await runTaskNow("co_1", 5, NOW, "user@vyron");

    expect(taskRepo.claimTaskForRunning).toHaveBeenCalledWith("co_1", 5);
    expect(runRuleEngine).toHaveBeenCalledWith("co_1", "user@vyron");
  });
});

describe("runDueTasks — tenant isolation unchanged", () => {
  it("scopes every repository call to the exact company passed in, never a different one", async () => {
    vi.mocked(taskRepo.listDueTasks).mockImplementation(async (companyId) => (companyId === "company-a" ? [task({ id: 1, taskType: "RuleEngineRun", companyId: "company-a" })] : []));
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 1, autoPosted: 0, exceptionsRaised: 0, results: [] });

    await runDueTasks("company-a", NOW);

    expect(taskRepo.listDueTasks).toHaveBeenCalledWith("company-a", NOW);
    expect(runRuleEngine).toHaveBeenCalledWith("company-a", "System");
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
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 1, autoPosted: 0, exceptionsRaised: 0, results: [] });

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
    vi.mocked(runRuleEngine).mockResolvedValue({ processed: 1, autoPosted: 0, exceptionsRaised: 0, results: [] });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
  });
});

describe("runDueTasks — AiClassificationSweep dispatch (Phase 26E)", () => {
  it("calls the shared classification sweep and reports Success with its outcome as the run summary", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 20, classified: 12, autoAllocated: 5, noConfidentSuggestion: 3, failed: 0, rateLimited: 0, hasMoreEligible: true });

    const outcome = await runDueTasks("co_1", NOW);

    expect(runAutomaticAiClassificationSweep).toHaveBeenCalledWith("co_1", "System");
    expect(outcome).toEqual({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Success", null, expect.objectContaining({ attempted: 20, autoAllocated: 5 }));
  });

  it("reschedules SOON (not the normal hourly cadence) when hasMoreEligible is true — draining a historical backlog across a few passes, not one pass per hour", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 20, classified: 20, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: true });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBeLessThan(60 * 60_000);
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBeGreaterThan(0);
  });

  it("falls back to the normal hourly cadence once caught up (hasMoreEligible: false, no rate limit)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 3, classified: 3, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(60 * 60_000);
  });

  it("reschedules soon when the sweep hit a rate limit, so the next pass backs off instead of hammering the provider immediately", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 5, classified: 5, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false });

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
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 6, classified: 0, autoAllocated: 5, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: true, retryAfterMs: 20_000 });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(20_000);
  });

  it("never reschedules faster than the 15-second safety floor even if retryAfterMs is implausibly small", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false, retryAfterMs: 1_000 });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(15_000);
  });

  it("never reschedules slower than the existing flat 5-minute ceiling even if retryAfterMs is implausibly large", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false, retryAfterMs: 60 * 60_000 });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(5 * 60_000);
  });

  it("falls back to the flat 5-minute default when rate-limited but retryAfterMs is absent (provider gave no header)", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 1, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 1, hasMoreEligible: false });

    await runDueTasks("co_1", NOW);

    const call = vi.mocked(taskRepo.recordTaskOutcome).mock.calls.find((c) => c[1] === 1);
    const nextRunAt = (call?.[2] as { nextRunAt: string }).nextRunAt;
    expect(Date.parse(nextRunAt) - Date.parse(NOW)).toBe(5 * 60_000);
  });

  it("a total sweep failure (every attempted transaction failed) is recorded as a real Failed run, not a silent Success — same precedent as a total BankSync outage", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep", retryCount: 0, maxRetries: 3 })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 3, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 3, rateLimited: 0, hasMoreEligible: false });

    const outcome = await runDueTasks("co_1", NOW);

    expect(outcome).toEqual({ processed: 1, succeeded: 0, failed: 1, deferred: 0 });
    expect(taskRepo.finishTaskRun).toHaveBeenCalledWith("co_1", expect.anything(), "Failed", expect.stringContaining("AI Classification sweep failed"), {});
  });

  it("a batch with only noConfidentSuggestion/rateLimited outcomes (no `failed`) is still a healthy Success, never treated as an outage", async () => {
    vi.mocked(taskRepo.listDueTasks).mockResolvedValue([task({ id: 1, taskType: "AiClassificationSweep" })]);
    vi.mocked(runAutomaticAiClassificationSweep).mockResolvedValue({ attempted: 2, classified: 0, autoAllocated: 0, noConfidentSuggestion: 1, failed: 0, rateLimited: 1, hasMoreEligible: false });

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
    expect(runAutomaticAiClassificationSweep).toHaveBeenCalledWith("company-a", "System");
  });
});
