import { describe, expect, it } from "vitest";
import { buildBackgroundJobsSummary } from "./background-jobs-engine";
import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

function task(overrides: Partial<AutomationTask>): AutomationTask {
  return {
    id: 1, companyId: "co_1", taskType: "RuleEngineRun", referenceId: null, name: "T", status: "Queued",
    nextRunAt: "2026-01-01T00:00:00Z", lastRunAt: null, lastRunStatus: null, lastRunDurationMs: null,
    retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<AutomationTaskRun>): AutomationTaskRun {
  return { id: 1, taskId: 1, companyId: "co_1", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null, status: "Running", errorMessage: null, summary: {}, ...overrides };
}

const now = "2026-01-01T00:20:00.000Z";

describe("buildBackgroundJobsSummary", () => {
  it("counts tasks by status", () => {
    const summary = buildBackgroundJobsSummary(
      [task({ status: "Queued" }), task({ status: "Running" }), task({ status: "Failed", retryCount: 1, maxRetries: 3 }), task({ status: "Failed", retryCount: 3, maxRetries: 3 })],
      [],
      now,
    );
    expect(summary.waiting).toBe(1);
    expect(summary.running).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.retrying).toBe(1);
  });

  it("flags a run started 10+ minutes ago as long-running", () => {
    const summary = buildBackgroundJobsSummary([], [run({ startedAt: "2026-01-01T00:09:00.000Z" })], now);
    expect(summary.longRunning).toHaveLength(1);
  });

  it("does not flag a run started less than 10 minutes ago", () => {
    const summary = buildBackgroundJobsSummary([], [run({ startedAt: "2026-01-01T00:15:00.000Z" })], now);
    expect(summary.longRunning).toHaveLength(0);
  });

  it("flags a run started 30+ minutes ago as stuck, not merely long-running", () => {
    const summary = buildBackgroundJobsSummary([], [run({ startedAt: "2025-12-31T23:49:00.000Z" })], now);
    expect(summary.stuckJobs).toHaveLength(1);
    expect(summary.longRunning).toHaveLength(1);
  });
});
