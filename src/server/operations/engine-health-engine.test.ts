import { describe, expect, it } from "vitest";
import {
  buildCopilotHealth, buildMatchingEngineHealth, buildNotificationEngineHealth, buildPostingEngineHealth,
  buildReportingEngineHealth, buildRuleEngineHealth, buildSchedulerHealth, buildVatEngineHealth, buildWorkflowEngineHealth,
} from "./engine-health-engine";
import type { AppNotification, AutomationTask, AutomationTaskRun, WorkflowInstance } from "@/server/automation/types";

function task(overrides: Partial<AutomationTask>): AutomationTask {
  return {
    id: 1, companyId: "co_1", taskType: "RuleEngineRun", referenceId: null, name: "T", status: "Queued",
    nextRunAt: "2026-01-01T00:00:00Z", lastRunAt: null, lastRunStatus: null, lastRunDurationMs: null,
    retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<AutomationTaskRun>): AutomationTaskRun {
  return {
    id: 1, taskId: 1, companyId: "co_1", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:05.000Z",
    status: "Success", errorMessage: null, summary: {},
    ...overrides,
  };
}

describe("buildSchedulerHealth", () => {
  it("is NotInstrumented with no runs", () => {
    expect(buildSchedulerHealth([], []).status).toBe("NotInstrumented");
  });

  it("is Healthy with zero failures", () => {
    const health = buildSchedulerHealth([], [run({ status: "Success" }), run({ status: "Success" })]);
    expect(health.status).toBe("Healthy");
    expect(health.errorCount.value).toBe(0);
  });

  it("is Degraded with a low failure rate", () => {
    const runs = [run({ status: "Failed" }), ...Array.from({ length: 9 }, () => run({ status: "Success" }))];
    expect(buildSchedulerHealth([], runs).status).toBe("Degraded");
  });

  it("is Failing with a high failure rate", () => {
    const runs = [run({ status: "Failed" }), run({ status: "Failed" }), run({ status: "Success" })];
    expect(buildSchedulerHealth([], runs).status).toBe("Failing");
  });

  it("computes average duration only from finished runs", () => {
    const runs = [
      run({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:10.000Z" }),
      run({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:20.000Z" }),
      run({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null }),
    ];
    const health = buildSchedulerHealth([], runs);
    expect(health.avgExecutionTimeMs.value).toBe(15000);
    expect(health.avgExecutionTimeMs.quality).toBe("Calculated");
  });

  it("reports queue depth from Queued tasks", () => {
    const health = buildSchedulerHealth([task({ status: "Queued" }), task({ status: "Running" })], []);
    expect(health.queueDepth.value).toBe(1);
  });
});

describe("buildRuleEngineHealth", () => {
  it("discloses it only covers scheduler-triggered runs", () => {
    const health = buildRuleEngineHealth([], [run({})]);
    expect(health.lastExecutionAt.note).toContain("Automation Scheduler");
  });
});

describe("buildWorkflowEngineHealth", () => {
  function instance(overrides: Partial<WorkflowInstance>): WorkflowInstance {
    return { id: 1, companyId: "co_1", workflowDefinitionId: 1, subjectType: "X", subjectId: 1, currentStep: 0, status: "Pending", createdAt: "2026-01-01T00:00:00Z", ...overrides };
  }

  it("is NotInstrumented with no instances", () => {
    expect(buildWorkflowEngineHealth([]).status).toBe("NotInstrumented");
  });

  it("counts Pending instances as queue depth", () => {
    const health = buildWorkflowEngineHealth([instance({ status: "Pending" }), instance({ status: "Approved" })]);
    expect(health.queueDepth.value).toBe(1);
  });

  it("is Degraded when rejected instances exceed 30%", () => {
    const instances = [instance({ status: "Rejected" }), instance({ status: "Rejected" }), instance({ status: "Approved" })];
    expect(buildWorkflowEngineHealth(instances).status).toBe("Degraded");
  });
});

describe("buildNotificationEngineHealth", () => {
  function notif(overrides: Partial<AppNotification>): AppNotification {
    return {
      id: 1, companyId: "co_1", recipient: "Company-wide", notificationType: "TaskAssignment", title: "T", message: "",
      severity: "info", isRead: false, emailStatus: "NotSent", relatedType: null, relatedId: null, createdAt: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("is NotInstrumented with zero notifications", () => {
    expect(buildNotificationEngineHealth([]).status).toBe("NotInstrumented");
  });

  it("is Degraded when any critical notification exists", () => {
    expect(buildNotificationEngineHealth([notif({ severity: "critical" })]).status).toBe("Degraded");
  });

  it("counts unread as queue depth", () => {
    const health = buildNotificationEngineHealth([notif({ isRead: false }), notif({ isRead: true })]);
    expect(health.queueDepth.value).toBe(1);
  });
});

describe("engines with no execution tracking are honestly NotInstrumented", () => {
  it("Posting Engine reports Calculated last-activity only, never a fabricated duration/error", () => {
    const health = buildPostingEngineHealth("2026-01-01T00:00:00Z");
    expect(health.status).toBe("NotInstrumented");
    expect(health.lastExecutionAt.quality).toBe("Calculated");
    expect(health.errorCount.quality).toBe("NotAvailable");
    expect(health.avgExecutionTimeMs.quality).toBe("NotAvailable");
  });

  it("Matching Engine reports null last-activity when there are no overrides at all", () => {
    const health = buildMatchingEngineHealth(null);
    expect(health.lastExecutionAt.value).toBeNull();
    expect(health.lastExecutionAt.quality).toBe("NotAvailable");
  });

  it("VAT Engine and Reporting Engine never fabricate error/duration data", () => {
    expect(buildVatEngineHealth("2026-01-01T00:00:00Z", 3).errorCount.quality).toBe("NotAvailable");
    expect(buildReportingEngineHealth(null).avgExecutionTimeMs.quality).toBe("NotAvailable");
  });

  it("AI Copilot never claims a queue or execution duration", () => {
    const health = buildCopilotHealth("2026-01-01T00:00:00Z");
    expect(health.queueDepth.quality).toBe("NotAvailable");
    expect(health.avgExecutionTimeMs.quality).toBe("NotAvailable");
  });
});
