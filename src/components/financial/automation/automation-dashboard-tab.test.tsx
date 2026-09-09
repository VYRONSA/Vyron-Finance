/**
 * Phase 26G — closes the exact gap this investigation traced: a task's
 * `Status: Success` badge alone can't distinguish "ran and did real
 * work" from "ran and genuinely did nothing" (e.g. `AiClassificationSweep`
 * with 0 eligible transactions, or every candidate coming back low-
 * confidence). `automation_task_runs.summary` has always stored the real
 * per-run outcome; this proves it's now actually rendered.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutomationDashboardTab } from "./automation-dashboard-tab";
import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function task(overrides: Partial<AutomationTask> & Pick<AutomationTask, "id" | "taskType">): AutomationTask {
  return {
    companyId: "co_1", referenceId: null, name: overrides.taskType, status: "Success",
    nextRunAt: "2026-08-17T02:00:00Z", lastRunAt: "2026-08-16T14:00:00Z", lastRunStatus: "Success",
    lastRunDurationMs: 500, retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-08-12T00:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<AutomationTaskRun> & Pick<AutomationTaskRun, "taskId" | "summary">): AutomationTaskRun {
  return {
    id: 1, companyId: "co_1", startedAt: "2026-08-16T14:00:00Z", finishedAt: "2026-08-16T14:00:01Z",
    status: "Success", errorMessage: null,
    ...overrides,
  };
}

describe("AutomationDashboardTab — Phase 26G observability", () => {
  it("shows the real per-run outcome, not just the Success badge, when a summary was recorded", () => {
    const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
    const recentRuns = [run({ taskId: 1, summary: { attempted: 20, classified: 5, autoAllocated: 3, noConfidentSuggestion: 12, failed: 0, rateLimited: 0 } })];

    render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);

    expect(screen.getByText(/attempted: 20/)).toBeInTheDocument();
    expect(screen.getByText(/autoAllocated: 3/)).toBeInTheDocument();
    expect(screen.getByText(/noConfidentSuggestion: 12/)).toBeInTheDocument();
  });

  it("makes a genuinely zero-progress 'Success' visibly distinct from a productive one — the exact confusion this phase traced", () => {
    const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
    const recentRuns = [run({ taskId: 1, summary: { attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false } })];

    render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);

    // "attempted: 0" is visible in the subtext, same as before...
    expect(screen.getByText(/attempted: 0/)).toBeInTheDocument();
  });

  // Phase 29C — the forensic audit's own finding: the badge ITSELF used
  // to say bare "Success" for all three of these cases, indistinguishable
  // from a run that genuinely classified transactions. Now the badge
  // text itself is honest, not just the small gray subtext underneath.
  describe("Phase 29C — the badge itself now distinguishes AI sweep outcomes", () => {
    it("shows 'No eligible transactions' (not 'Success') when attempted=0", () => {
      const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
      const recentRuns = [run({ taskId: 1, summary: { attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false } })];
      render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);
      expect(screen.getByText("No eligible transactions")).toBeInTheDocument();
      expect(screen.queryByText("Success")).not.toBeInTheDocument();
    });

    it("shows 'Rate limited' (not 'Success') when the sweep was fully rate-limited", () => {
      const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
      const recentRuns = [run({ taskId: 1, summary: { attempted: 5, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 5, hasMoreEligible: true } })];
      render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);
      expect(screen.getByText("Rate limited")).toBeInTheDocument();
      expect(screen.queryByText("Success")).not.toBeInTheDocument();
    });

    it("shows 'No confident suggestions' (not 'Success') when the AI found nothing worth suggesting", () => {
      const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
      const recentRuns = [run({ taskId: 1, summary: { attempted: 5, classified: 0, autoAllocated: 0, noConfidentSuggestion: 5, failed: 0, rateLimited: 0, hasMoreEligible: false } })];
      render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);
      expect(screen.getByText("No confident suggestions")).toBeInTheDocument();
      expect(screen.queryByText("Success")).not.toBeInTheDocument();
    });

    it("still shows plain 'Success' when the sweep genuinely classified transactions", () => {
      const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
      const recentRuns = [run({ taskId: 1, summary: { attempted: 5, classified: 3, autoAllocated: 0, noConfidentSuggestion: 2, failed: 0, rateLimited: 0, hasMoreEligible: false } })];
      render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);
      expect(screen.getByText("Success")).toBeInTheDocument();
    });

    it("non-AiClassificationSweep task types keep the plain 'Success' badge unchanged", () => {
      const tasks = [task({ id: 1, taskType: "BankSync" })];
      const recentRuns = [run({ taskId: 1, summary: { attempted: 5, succeeded: 5 } })];
      render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);
      expect(screen.getByText("Success")).toBeInTheDocument();
    });

    it("a task with no last run yet keeps the plain status badge (nothing to categorize)", () => {
      const tasks = [task({ id: 1, taskType: "AiClassificationSweep", status: "Queued", lastRunAt: null })];
      render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={[]} auditLog={[]} previewMode={false} />);
      expect(screen.getByText("Queued")).toBeInTheDocument();
    });
  });

  it("shows nothing extra for a task type with no summary data (e.g. a task that has never run)", () => {
    const tasks = [task({ id: 1, taskType: "RuleEngineRun", lastRunAt: null, lastRunStatus: null })];
    render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={[]} auditLog={[]} previewMode={false} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("matches each row to the correct task's run by taskId, never mixing up two tasks' summaries", () => {
    const tasks = [task({ id: 1, taskType: "AiClassificationSweep" }), task({ id: 2, taskType: "BankSync" })];
    const recentRuns = [
      run({ taskId: 1, summary: { attempted: 20 } }),
      run({ taskId: 2, summary: { attempted: 3, succeeded: 3, failed: 0 } }),
    ];

    render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);

    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("attempted: 20");
    expect(rows[2]).toHaveTextContent("succeeded: 3");
  });

  it("uses the MOST RECENT run when more than one exists for the same task today", () => {
    const tasks = [task({ id: 1, taskType: "AiClassificationSweep" })];
    const recentRuns = [
      run({ taskId: 1, startedAt: "2026-08-16T08:00:00Z", summary: { attempted: 20, rateLimited: 1 } }),
      run({ taskId: 1, startedAt: "2026-08-16T14:00:00Z", summary: { attempted: 20, autoAllocated: 4 } }),
    ];

    render(<AutomationDashboardTab companyId="co_1" tasks={tasks} recentRuns={recentRuns} auditLog={[]} previewMode={false} />);

    expect(screen.getByText(/autoAllocated: 4/)).toBeInTheDocument();
    expect(screen.queryByText(/rateLimited: 1/)).not.toBeInTheDocument();
  });
});
