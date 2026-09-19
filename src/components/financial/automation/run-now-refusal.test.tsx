/**
 * Phase 5D — a refused "Run Now" must not look like a run that happened.
 *
 * The server is the enforcement point (a suspended/disabled task, or a
 * Rule Engine / BankSync run without `Banking:Post`, is refused in
 * `runTaskNow` and at the route). This covers the other half: the row
 * used to ignore the response entirely and call `router.refresh()`
 * regardless, so a 400/403 was indistinguishable from success.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutomationDashboardTab } from "./automation-dashboard-tab";
import type { AutomationTask } from "@/server/automation/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function task(overrides: Partial<AutomationTask> & Pick<AutomationTask, "id" | "taskType">): AutomationTask {
  return {
    companyId: "co_1", referenceId: null, name: overrides.taskType, status: "Suspended",
    nextRunAt: "2026-08-17T02:00:00Z", lastRunAt: null, lastRunStatus: null,
    lastRunDurationMs: null, retryCount: 3, maxRetries: 3, isActive: false, createdAt: "2026-08-12T00:00:00Z",
    ...overrides,
  };
}

function renderDashboard(t: AutomationTask) {
  return render(<AutomationDashboardTab companyId="co_1" tasks={[t]} recentRuns={[]} auditLog={[]} previewMode={false} />);
}

beforeEach(() => {
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Run Now refusals are shown, not swallowed", () => {
  it("shows the server's suspended-task message and does NOT refresh as though it ran", async () => {
    const message = "This task is suspended and must be resumed before it can be run.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: message }) }));

    renderDashboard(task({ id: 1, taskType: "RuleEngineRun", status: "Suspended" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a permission refusal (403) rather than silently appearing to run", async () => {
    const message = 'Your role ("Bookkeeper") does not have the "Banking:Post" permission.';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: message }) }));

    renderDashboard(task({ id: 1, taskType: "RuleEngineRun", status: "Queued" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Banking:Post");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a plain message when the server sends no error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("no body"); } }));

    renderDashboard(task({ id: 1, taskType: "RuleEngineRun" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a successful run still refreshes and shows no alert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }));

    renderDashboard(task({ id: 1, taskType: "RuleEngineRun", status: "Queued" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a network failure is reported too, never treated as a run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    renderDashboard(task({ id: 1, taskType: "RuleEngineRun" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't reach the API/);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Phase 5E — Run Scheduler Now reports skipped posting tasks", () => {
  const outcome = {
    processed: 1,
    succeeded: 1,
    failed: 0,
    deferred: 0,
    refused: 1,
    refusedTasks: [{ taskId: 2, taskType: "RuleEngineRun", name: "Banking Rules recovery sweep", reason: 'needs the "Banking:Post" permission' }],
  };

  it("names the skipped task and says it is unchanged and still due — never silently omitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome }) }));

    renderDashboard(task({ id: 1, taskType: "CommunicationQueue", status: "Queued" }));
    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler Now/ }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Banking Rules recovery sweep");
    expect(notice).toHaveTextContent("Banking:Post");
    expect(notice).toHaveTextContent(/unchanged and still due/);
  });

  it("still reports what DID run alongside the refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome }) }));

    renderDashboard(task({ id: 1, taskType: "CommunicationQueue", status: "Queued" }));
    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler Now/ }));

    expect(await screen.findByText(/Processed 1 task\(s\)/)).toBeInTheDocument();
  });

  it("shows no refusal notice on a clean run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome: { processed: 2, succeeded: 2, failed: 0, deferred: 0 } }) }));

    renderDashboard(task({ id: 1, taskType: "CommunicationQueue", status: "Queued" }));
    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler Now/ }));

    await waitFor(() => expect(screen.getByText(/Processed 2 task\(s\)/)).toBeInTheDocument());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a failed Run Scheduler Now request is reported, not shown as a run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "denied" }) }));

    renderDashboard(task({ id: 1, taskType: "CommunicationQueue", status: "Queued" }));
    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler Now/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("denied");
    expect(screen.queryByText(/Processed/)).toBeNull();
  });
});
