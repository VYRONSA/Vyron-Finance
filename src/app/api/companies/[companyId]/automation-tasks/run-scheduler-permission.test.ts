/**
 * Phase 5E — "Run Scheduler Now" at the route.
 *
 * `RunAutomation` still gates the action. Whether the run may execute
 * task types that POST accounting journals is a separate question,
 * answered with `Banking:Post` and passed down as `mayPost`. The queue is
 * a loop of independently claimed tasks, so a caller without it still
 * runs the non-posting tasks; the posting ones are left due and reported.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/server/services/scheduler-service", () => ({ listAutomationTasks: vi.fn(), runDueTasks: vi.fn() }));
vi.mock("@/server/services/operations-service", () => ({ recordSystemEvent: vi.fn() }));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { runDueTasks } from "@/server/services/scheduler-service";
import { recordSystemEvent } from "@/server/services/operations-service";

const params = { params: Promise.resolve({ companyId: "co_1" }) };
const request = () => new Request("http://localhost/api/companies/co_1/automation-tasks", { method: "POST" });

const CLEAN = { processed: 2, succeeded: 2, failed: 0, deferred: 0 };
const REFUSED = {
  processed: 1,
  succeeded: 1,
  failed: 0,
  deferred: 0,
  refused: 1,
  refusedTasks: [{ taskId: 2, taskType: "RuleEngineRun", name: "Banking Rules recovery sweep", reason: 'needs the "Banking:Post" permission' }],
};

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("user@vyron");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(hasPermission).mockReset().mockResolvedValue(true);
  vi.mocked(runDueTasks).mockReset().mockResolvedValue(CLEAN as never);
  vi.mocked(recordSystemEvent).mockReset().mockResolvedValue(undefined);
});

describe("POST automation-tasks — Run Scheduler Now", () => {
  it("still requires RunAutomation, and runs nothing without it", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) });

    const response = await POST(request(), params);

    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "RunAutomation");
    expect(runDueTasks).not.toHaveBeenCalled();
  });

  it("passes mayPost false when the caller has no Banking:Post", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(runDueTasks).mockResolvedValue(REFUSED as never);

    await POST(request(), params);

    expect(hasPermission).toHaveBeenCalledWith("co_1", "Banking:Post");
    expect(runDueTasks).toHaveBeenCalledWith("co_1", expect.any(String), "user@vyron", { mayPost: false });
  });

  it("passes mayPost true when the caller has Banking:Post", async () => {
    await POST(request(), params);
    expect(runDueTasks).toHaveBeenCalledWith("co_1", expect.any(String), "user@vyron", { mayPost: true });
  });

  it("still returns 200 and the outcome when posting tasks were skipped — the queue did run", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(runDueTasks).mockResolvedValue(REFUSED as never);

    const response = await POST(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toMatchObject({ processed: 1, succeeded: 1, refused: 1 });
    expect(body.outcome.refusedTasks[0]).toMatchObject({ taskId: 2, taskType: "RuleEngineRun" });
  });

  it("records a PermissionDenied event naming the skipped tasks", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(runDueTasks).mockResolvedValue(REFUSED as never);

    await POST(request(), params);

    expect(recordSystemEvent).toHaveBeenCalledWith(
      "co_1",
      "PermissionDenied",
      "warning",
      "user@vyron",
      expect.stringContaining("Banking:Post"),
      expect.objectContaining({ permissionKey: "Banking:Post", refusedTasks: [{ taskId: 2, taskType: "RuleEngineRun" }] }),
    );
  });

  it("records NO PermissionDenied event on a run that skipped nothing", async () => {
    await POST(request(), params);
    expect(recordSystemEvent).not.toHaveBeenCalled();
  });

  it("an observability failure never changes what the scheduler did", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(runDueTasks).mockResolvedValue(REFUSED as never);
    vi.mocked(recordSystemEvent).mockRejectedValue(new Error("system_events unreachable"));

    const response = await POST(request(), params);

    expect(response.status).toBe(200);
    expect((await response.json()).outcome.refused).toBe(1);
  });

  it("asks about exactly the company in the path (tenant isolation)", async () => {
    const otherParams = { params: Promise.resolve({ companyId: "co_2" }) };
    await POST(request(), otherParams);

    expect(requirePermission).toHaveBeenCalledWith("co_2", "RunAutomation");
    expect(hasPermission).toHaveBeenCalledWith("co_2", "Banking:Post");
    expect(runDueTasks).toHaveBeenCalledWith("co_2", expect.any(String), "user@vyron", { mayPost: true });
  });

  it("an unauthenticated request never reaches a permission check or the scheduler", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);

    const response = await POST(request(), params);

    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(runDueTasks).not.toHaveBeenCalled();
  });
});
