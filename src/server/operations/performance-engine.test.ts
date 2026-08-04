import { describe, expect, it } from "vitest";
import { buildPerformanceSummary, summarizeTaskDurations } from "./performance-engine";
import type { AutomationTaskRun } from "@/server/automation/types";

function run(overrides: Partial<AutomationTaskRun>): AutomationTaskRun {
  return { id: 1, taskId: 1, companyId: "co_1", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:05.000Z", status: "Success", errorMessage: null, summary: {}, ...overrides };
}

describe("summarizeTaskDurations", () => {
  it("computes average and last duration per task type", () => {
    const result = summarizeTaskDurations({
      RuleEngineRun: [
        run({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:10.000Z" }),
        run({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:20.000Z" }),
      ],
    });
    expect(result[0].avgDurationMs).toBe(15000);
    expect(result[0].sampleCount).toBe(2);
  });

  it("returns null duration for a task type with no finished runs", () => {
    const result = summarizeTaskDurations({ CommunicationQueue: [run({ finishedAt: null })] });
    expect(result[0].avgDurationMs).toBeNull();
  });
});

describe("buildPerformanceSummary", () => {
  it("never fabricates infrastructure metrics", () => {
    const summary = buildPerformanceSummary({});
    expect(summary.cpuUsage.quality).toBe("NotAvailable");
    expect(summary.memoryUsage.quality).toBe("NotAvailable");
    expect(summary.slowestQueries.quality).toBe("NotAvailable");
    expect(summary.slowestApis.value).toBeNull();
  });
});
