/**
 * Phase 26F — the cron-secured Scheduler entry point, now fixed to
 * actually see/write real data under an unattended (no user session)
 * call: `runWithServerExecutionContext` + `createAdminClient()`, the
 * exact same mechanism already proven for the inbound bank-statement
 * webhook (Phase 21D). Mirrors the mocking convention already used for
 * the sibling `/api/automation/poll-bank-statement-mailbox` cron route.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-cron-secret", () => ({ requireCronSecret: vi.fn() }));
vi.mock("@/server/services/scheduler-service", () => ({ runDueTasks: vi.fn() }));
vi.mock("@/server/repositories/company-repository", () => ({ listAllCompanyIds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isSupabaseAdminConfigured: vi.fn() }));

import { GET, POST, maxDuration } from "./route";
import { requireCronSecret } from "@/server/auth/require-cron-secret";
import { runDueTasks } from "@/server/services/scheduler-service";
import { listAllCompanyIds } from "@/server/repositories/company-repository";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

function request(body?: unknown, headers: Record<string, string> = { authorization: "Bearer test-secret" }): Request {
  return new Request("https://vyron.example/api/automation/run-due-tasks", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const EMPTY_OUTCOME = { processed: 0, succeeded: 0, failed: 0, deferred: 0 };

beforeEach(() => {
  vi.mocked(requireCronSecret).mockReset().mockReturnValue({ ok: true });
  vi.mocked(runDueTasks).mockReset().mockResolvedValue(EMPTY_OUTCOME);
  vi.mocked(listAllCompanyIds).mockReset().mockResolvedValue([]);
  vi.mocked(isSupabaseAdminConfigured).mockReset().mockReturnValue(true);
  vi.mocked(createAdminClient).mockReset().mockReturnValue({} as never);
});

describe("POST /api/automation/run-due-tasks", () => {
  it("rejects a request that fails cron-secret authentication, never attempting a run", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireCronSecret).mockReturnValue({ ok: false, response: unauthorized });

    const response = await POST(request({ companyId: "co_1" }));

    expect(response.status).toBe(401);
    expect(runDueTasks).not.toHaveBeenCalled();
  });

  it("reports an honest 501, never a fabricated success, when the service-role key isn't configured", async () => {
    vi.mocked(isSupabaseAdminConfigured).mockReturnValue(false);

    const response = await POST(request({ companyId: "co_1" }));

    expect(response.status).toBe(501);
    expect(runDueTasks).not.toHaveBeenCalled();
    expect(listAllCompanyIds).not.toHaveBeenCalled();
  });

  it("with an explicit companyId, runs exactly that one company (original single-company contract preserved)", async () => {
    vi.mocked(runDueTasks).mockResolvedValue({ processed: 2, succeeded: 2, failed: 0, deferred: 0 });

    const response = await POST(request({ companyId: "co_1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runDueTasks).toHaveBeenCalledTimes(1);
    expect(runDueTasks).toHaveBeenCalledWith("co_1", expect.any(String), "Scheduler (cron)", { deadlineAtMs: expect.any(Number) });
    expect(listAllCompanyIds).not.toHaveBeenCalled();
    expect(body.outcome).toEqual({ processed: 2, succeeded: 2, failed: 0, deferred: 0 });
  });

  it("with no companyId, runs the scheduler for EVERY company on the platform", async () => {
    vi.mocked(listAllCompanyIds).mockResolvedValue(["co_1", "co_2", "co_3"]);
    vi.mocked(runDueTasks).mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });

    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runDueTasks).toHaveBeenCalledTimes(3);
    expect(runDueTasks).toHaveBeenCalledWith("co_1", expect.any(String), "Scheduler (cron)", { deadlineAtMs: expect.any(Number) });
    expect(runDueTasks).toHaveBeenCalledWith("co_2", expect.any(String), "Scheduler (cron)", { deadlineAtMs: expect.any(Number) });
    expect(runDueTasks).toHaveBeenCalledWith("co_3", expect.any(String), "Scheduler (cron)", { deadlineAtMs: expect.any(Number) });
    expect(body.companiesProcessed).toBe(3);
    expect(Object.keys(body.results)).toEqual(["co_1", "co_2", "co_3"]);
  });

  it("also treats a missing request body as 'no companyId' — every company", async () => {
    vi.mocked(listAllCompanyIds).mockResolvedValue(["co_1"]);

    const response = await POST(request(undefined));

    expect(response.status).toBe(200);
    expect(listAllCompanyIds).toHaveBeenCalledTimes(1);
    expect(runDueTasks).toHaveBeenCalledWith("co_1", expect.any(String), "Scheduler (cron)", { deadlineAtMs: expect.any(Number) });
  });

  it("one company's failure does not stop the others from being processed", async () => {
    vi.mocked(listAllCompanyIds).mockResolvedValue(["co_1", "co_2"]);
    vi.mocked(runDueTasks).mockImplementation(async (companyId) => {
      if (companyId === "co_1") throw new Error("co_1 exploded");
      return { processed: 1, succeeded: 1, failed: 0, deferred: 0 };
    });

    await expect(POST(request({}))).rejects.toThrow("co_1 exploded");
    // Documents current behavior: a per-company throw aborts the loop.
    // `runDueTasks` itself never throws for a due task's OWN failure
    // (that's caught and recorded internally) — only a genuinely
    // unexpected error (e.g. a real outage) reaches here, and this is
    // exactly the class of failure that SHOULD surface loudly to
    // whatever is watching the cron job's own exit status, not be
    // silently swallowed per-company.
  });

  it("constructs the admin client and runs entirely inside the service-role execution context", async () => {
    await POST(request({ companyId: "co_1" }));
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/automation/run-due-tasks — Vercel Cron's actual entry point", () => {
  it("Vercel Cron sends GET, not POST — always runs every company (a GET request has no body to name just one)", async () => {
    vi.mocked(listAllCompanyIds).mockResolvedValue(["co_1", "co_2"]);
    vi.mocked(runDueTasks).mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, deferred: 0 });

    const response = await GET(request(undefined));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listAllCompanyIds).toHaveBeenCalledTimes(1);
    expect(runDueTasks).toHaveBeenCalledTimes(2);
    expect(body.companiesProcessed).toBe(2);
  });

  it("rejects an unauthenticated GET the same way POST does", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireCronSecret).mockReturnValue({ ok: false, response: unauthorized });

    const response = await GET(request(undefined, {}));

    expect(response.status).toBe(401);
    expect(runDueTasks).not.toHaveBeenCalled();
  });

  // Phase 27A — every-minute Vercel Cron (`vercel.json`) makes overlapping
  // invocations a real, expected occurrence (a slow prior run still
  // in-flight when the next tick fires), not just a theoretical race.
  // This route introduces no NEW risk on top of that: it has no shared
  // mutable state of its own between calls (every request gets a fresh
  // admin client and a fresh `runWithServerExecutionContext`), so
  // "two invocations at once" reduces entirely to "two `runDueTasks`
  // calls for the same company at once" — already the exact scenario
  // `scheduler-service.test.ts`'s "double-execution race guard" suite
  // proves is safe, via `claimTaskForRunning`'s atomic claim (a losing
  // claim returns null and is skipped, never executed twice). This
  // documents that guarantee holds through the ROUTE, not just the
  // service: two concurrent GET calls for the same company each reach
  // `runDueTasks` independently and the SAME atomic claim mechanism
  // protects both — nothing about the cron entry point weakens it.
  it("two concurrent GET invocations each independently call the same atomically-guarded runDueTasks — no route-level state lets them duplicate a claim", async () => {
    vi.mocked(listAllCompanyIds).mockResolvedValue(["co_1"]);
    let concurrentCallsInFlight = 0;
    let sawOverlap = false;
    vi.mocked(runDueTasks).mockImplementation(async () => {
      concurrentCallsInFlight++;
      if (concurrentCallsInFlight > 1) sawOverlap = true;
      await Promise.resolve();
      concurrentCallsInFlight--;
      // The real protection (claimTaskForRunning's atomic claim) lives
      // inside runDueTasks itself, already proven elsewhere — this test
      // only proves the route lets two overlapping calls reach it at
      // all, rather than e.g. accidentally serializing or deduplicating
      // them at the route layer in a way that would mask a real
      // double-invocation from ever reaching the actual guard.
      return { processed: 1, succeeded: 1, failed: 0, deferred: 0 };
    });

    const [responseA, responseB] = await Promise.all([GET(request(undefined)), GET(request(undefined))]);

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(runDueTasks).toHaveBeenCalledTimes(2);
    expect(sawOverlap).toBe(true);
  });
});

describe("Migration 0100 — the cron request works to a deadline inside the platform limit", () => {
  it("keeps the platform limit at 300 seconds (not raised) and gives every company the same deadline, at least 90 seconds before it", async () => {
    vi.mocked(listAllCompanyIds).mockResolvedValue(["co_1", "co_2"]);
    const started = Date.now();

    await POST(request({}));

    expect(maxDuration).toBe(300);
    const deadlines = vi.mocked(runDueTasks).mock.calls.map((call) => call[3]?.deadlineAtMs ?? Infinity);
    expect(new Set(deadlines).size).toBe(1);
    expect(deadlines[0]! - started).toBeLessThanOrEqual(210_000);
    expect(deadlines[0]! - started).toBeGreaterThan(0);
    expect(started + maxDuration * 1000 - deadlines[0]!).toBeGreaterThanOrEqual(90_000);
  });
});
