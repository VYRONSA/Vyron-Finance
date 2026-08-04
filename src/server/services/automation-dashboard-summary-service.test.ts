import { describe, expect, it } from "vitest";
import { buildAutomationDashboardSummary } from "./automation-dashboard-summary-service";
import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

function task(overrides: Partial<AutomationTask> & { id: number }): AutomationTask {
  return {
    companyId: "co_1", taskType: "RecurringTemplate", referenceId: 1, name: "Task",
    status: "Queued", nextRunAt: "2026-08-01T00:00:00Z", lastRunAt: null, lastRunStatus: null,
    lastRunDurationMs: null, retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<AutomationTaskRun> & { id: number; taskId: number }): AutomationTaskRun {
  return {
    companyId: "co_1", startedAt: "2026-08-01T08:00:00.000Z", finishedAt: "2026-08-01T08:00:01.000Z",
    status: "Success", errorMessage: null, summary: {},
    ...overrides,
  };
}

describe("buildAutomationDashboardSummary", () => {
  it("computes rule success/failure rate from today's runs", () => {
    const summary = buildAutomationDashboardSummary(
      [task({ id: 1 })],
      [run({ id: 1, taskId: 1, status: "Success" }), run({ id: 2, taskId: 1, status: "Success" }), run({ id: 3, taskId: 1, status: "Failed" })],
      0,
      10,
    );
    expect(summary.tasksExecutedToday).toBe(3);
    expect(summary.ruleSuccessRatePercent).toBeCloseTo(66.7, 1);
    expect(summary.ruleFailureRatePercent).toBeCloseTo(33.3, 1);
  });

  it("defaults to 100% success rate when nothing ran today", () => {
    const summary = buildAutomationDashboardSummary([], [], 0, 0);
    expect(summary.ruleSuccessRatePercent).toBe(100);
    expect(summary.ruleFailureRatePercent).toBe(0);
  });

  it("reports scheduler health as Healthy with zero failed tasks", () => {
    const summary = buildAutomationDashboardSummary([task({ id: 1, status: "Success" })], [], 0, 0);
    expect(summary.schedulerHealth).toBe("Healthy");
  });

  it("reports scheduler health as Down when most tasks are failed", () => {
    const summary = buildAutomationDashboardSummary(
      [task({ id: 1, status: "Failed" }), task({ id: 2, status: "Failed" }), task({ id: 3, status: "Queued" })],
      [],
      0,
      0,
    );
    expect(summary.schedulerHealth).toBe("Down");
  });

  it("counts a task in the retry queue only while retries remain", () => {
    const summary = buildAutomationDashboardSummary(
      [task({ id: 1, status: "Failed", retryCount: 1, maxRetries: 3 }), task({ id: 2, status: "Failed", retryCount: 3, maxRetries: 3 })],
      [],
      0,
      0,
    );
    expect(summary.retryQueueCount).toBe(1);
  });

  it("computes automation rate and manual intervention rate from open exceptions vs total processed", () => {
    const summary = buildAutomationDashboardSummary([], [], 20, 100);
    expect(summary.automationRatePercent).toBe(80);
    expect(summary.manualInterventionRatePercent).toBe(20);
  });

  it("ranks top automated processes by successful runs today", () => {
    const summary = buildAutomationDashboardSummary(
      [task({ id: 1, name: "Recurring Invoices" }), task({ id: 2, name: "Rule Engine" })],
      [
        run({ id: 1, taskId: 1, status: "Success" }),
        run({ id: 2, taskId: 1, status: "Success" }),
        run({ id: 3, taskId: 2, status: "Success" }),
      ],
      0,
      0,
    );
    expect(summary.topAutomatedProcesses[0]).toEqual({ name: "Recurring Invoices", successCount: 2 });
  });

  it("computes average processing time from finished runs only", () => {
    const summary = buildAutomationDashboardSummary(
      [],
      [
        run({ id: 1, taskId: 1, startedAt: "2026-08-01T08:00:00.000Z", finishedAt: "2026-08-01T08:00:02.000Z" }),
        run({ id: 2, taskId: 1, startedAt: "2026-08-01T08:00:00.000Z", finishedAt: null, status: "Running" }),
      ],
      0,
      0,
    );
    expect(summary.averageProcessingTimeMs).toBe(2000);
  });
});
