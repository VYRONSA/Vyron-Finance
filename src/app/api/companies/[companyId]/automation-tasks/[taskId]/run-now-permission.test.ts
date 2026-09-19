/**
 * Phase 5D — "Run task now" safety, at the route.
 *
 * `RunAutomation` says a person may work the scheduler. It does NOT say
 * they may post accounting journals — so a manual run of a RuleEngineRun
 * or BankSync task additionally needs `Banking:Post`, the same permission
 * those operations' own manual triggers require. AI classification posts
 * nothing and keeps its existing model.
 *
 * Task STATE (Suspended and Disabled are refused) is enforced in
 * `runTaskNow` itself, not here — these tests prove the route surfaces
 * that refusal honestly and never reports a refused run as done.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/server/services/scheduler-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/scheduler-service")>();
  return {
    // `taskPostsAccounting` and `ValidationError` are the REAL ones — the
    // route's decision must be driven by the real policy, not a stub.
    taskPostsAccounting: actual.taskPostsAccounting,
    ValidationError: actual.ValidationError,
    getAutomationTask: vi.fn(),
    listTaskRuns: vi.fn(),
    runTaskNow: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    disableTask: vi.fn(),
  };
});

import { PATCH } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { getAutomationTask, runTaskNow, ValidationError } from "@/server/services/scheduler-service";
import type { AutomationTask, AutomationTaskStatus, AutomationTaskType } from "@/server/automation/types";

const params = { params: Promise.resolve({ companyId: "co_1", taskId: "5" }) };
const request = (action: string) =>
  new Request("http://localhost/api/companies/co_1/automation-tasks/5", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });

function task(taskType: AutomationTaskType, status: AutomationTaskStatus = "Queued"): AutomationTask {
  return { id: 5, companyId: "co_1", taskType, name: taskType, status, referenceId: null, nextRunAt: "2026-01-01T00:00:00Z", lastRunAt: null, lastRunStatus: null, lastRunDurationMs: null, retryCount: 0, maxRetries: 3, isActive: true, createdAt: "2026-01-01T00:00:00Z" };
}

const DENIED = NextResponse.json({ error: 'Your role ("Bookkeeper") does not have the "Banking:Post" permission.' }, { status: 403 });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("user@vyron");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(hasPermission).mockReset().mockResolvedValue(true);
  vi.mocked(getAutomationTask).mockReset().mockResolvedValue(task("RuleEngineRun"));
  vi.mocked(runTaskNow).mockReset().mockResolvedValue(undefined);
});

describe("PATCH automation-tasks/[id] run-now — posting permission", () => {
  it("RunAutomation is still required for the route at all", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });
    const response = await PATCH(request("run-now"), params);
    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "RunAutomation");
    expect(runTaskNow).not.toHaveBeenCalled();
  });

  it("an ACTIVE Rule Engine task with RunAutomation ONLY is refused, and nothing runs", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(requirePermission).mockImplementation(async (_c, key) => (key === "Banking:Post" ? { ok: false, response: DENIED } : { ok: true }));

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("Banking:Post");
    expect(runTaskNow).not.toHaveBeenCalled();
  });

  it("an ACTIVE Rule Engine task with RunAutomation AND Banking:Post runs", async () => {
    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(200);
    expect(hasPermission).toHaveBeenCalledWith("co_1", "Banking:Post");
    expect(runTaskNow).toHaveBeenCalledWith("co_1", 5, expect.any(String), "user@vyron", { mayPost: true });
  });

  it("BankSync is gated the same way", async () => {
    vi.mocked(getAutomationTask).mockResolvedValue(task("BankSync"));
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(requirePermission).mockImplementation(async (_c, key) => (key === "Banking:Post" ? { ok: false, response: DENIED } : { ok: true }));

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(403);
    expect(runTaskNow).not.toHaveBeenCalled();
  });

  it("an AI classification task does NOT require Banking:Post — the shared framework is not a reason to demand it", async () => {
    vi.mocked(getAutomationTask).mockResolvedValue(task("AiClassificationSweep"));
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(requirePermission).mockImplementation(async (_c, key) => (key === "Banking:Post" ? { ok: false, response: DENIED } : { ok: true }));

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(200);
    expect(runTaskNow).toHaveBeenCalledWith("co_1", 5, expect.any(String), "user@vyron", { mayPost: false });
    // It never even asked for the posting permission as a gate.
    expect(requirePermission).not.toHaveBeenCalledWith("co_1", "Banking:Post");
  });

  it.each(["CommunicationQueue", "SubscriptionLifecycleSweep", "ReportRefresh", "Custom"] as const)("%s does not require Banking:Post either", async (taskType) => {
    vi.mocked(getAutomationTask).mockResolvedValue(task(taskType));
    vi.mocked(hasPermission).mockResolvedValue(false);

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(200);
    expect(requirePermission).not.toHaveBeenCalledWith("co_1", "Banking:Post");
  });

  it("RecurringTemplate DOES require Banking:Post — Phase 5E corrected its classification", async () => {
    // It posts through the sales / purchasing / GL modules: a Journal
    // template writes an Approved journal then calls postApprovedJournals,
    // and CustomerInvoice/SupplierBill templates approve-and-post. Phase
    // 5D had it classified as non-posting.
    vi.mocked(getAutomationTask).mockResolvedValue(task("RecurringTemplate"));
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(requirePermission).mockImplementation(async (_c, key) => (key === "Banking:Post" ? { ok: false, response: DENIED } : { ok: true }));

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(403);
    expect(runTaskNow).not.toHaveBeenCalled();
  });

  it("RecurringTemplate runs with Banking:Post", async () => {
    vi.mocked(getAutomationTask).mockResolvedValue(task("RecurringTemplate"));

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(200);
    expect(runTaskNow).toHaveBeenCalledWith("co_1", 5, expect.any(String), "user@vyron", { mayPost: true });
  });

  it("a missing task is a 404, not a run", async () => {
    vi.mocked(getAutomationTask).mockResolvedValue(null);
    const response = await PATCH(request("run-now"), params);
    expect(response.status).toBe(404);
    expect(runTaskNow).not.toHaveBeenCalled();
  });

  it("asks about exactly the company in the path (tenant isolation)", async () => {
    const otherParams = { params: Promise.resolve({ companyId: "co_2", taskId: "5" }) };
    await PATCH(request("run-now"), otherParams);

    expect(requirePermission).toHaveBeenCalledWith("co_2", "RunAutomation");
    expect(hasPermission).toHaveBeenCalledWith("co_2", "Banking:Post");
    expect(getAutomationTask).toHaveBeenCalledWith("co_2", 5);
    expect(runTaskNow).toHaveBeenCalledWith("co_2", 5, expect.any(String), "user@vyron", { mayPost: true });
  });

  it("an unauthenticated request never reaches a permission check or a run", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);
    const response = await PATCH(request("run-now"), params);
    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(runTaskNow).not.toHaveBeenCalled();
  });
});

describe("PATCH automation-tasks/[id] run-now — the service's state refusal reaches the caller", () => {
  it.each([
    ["suspended", "This task is suspended and must be resumed before it can be run."],
    ["disabled", "This task is disabled and must be resumed before it can be run."],
  ])("a %s task is refused with the exact message and a 4xx, never a success", async (_label, message) => {
    vi.mocked(runTaskNow).mockRejectedValue(new ValidationError(message));

    const response = await PATCH(request("run-now"), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
  });

  it("the other task actions are unaffected by the run-now gate", async () => {
    for (const action of ["pause", "resume", "disable"]) {
      const response = await PATCH(request(action), params);
      expect(response.status).toBe(200);
    }
    expect(runTaskNow).not.toHaveBeenCalled();
  });
});
