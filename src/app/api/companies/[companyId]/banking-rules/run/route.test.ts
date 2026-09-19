/**
 * Phase 5A — the manual "Run Rule Engine Now" trigger writes journals,
 * posting batches and GL rows, so it requires Banking:Post (the Bank
 * Posting permission), not only Banking:Edit.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/rule-processing-service", () => ({ runRuleEngine: vi.fn() }));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { runRuleEngine } from "@/server/services/rule-processing-service";

const params = { params: Promise.resolve({ companyId: "co_1" }) };
const request = () => new Request("http://localhost/api/companies/co_1/banking-rules/run", { method: "POST" });

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("owner@example.test");
  vi.mocked(requirePermission).mockReset();
  vi.mocked(runRuleEngine).mockReset().mockResolvedValue({ processed: 0 } as never);
});

describe("POST /banking-rules/run — posting permission", () => {
  it("checks Banking:Post (never only Banking:Edit)", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true });
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledTimes(1);
    expect(requirePermission).toHaveBeenCalledWith("co_1", "Banking:Post");
    expect(runRuleEngine).toHaveBeenCalledWith("co_1", "owner@example.test");
  });

  it("a user without Banking:Post is refused and the Rule Engine never runs", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Your role ("Bookkeeper") does not have the "Banking:Post" permission.' }, { status: 403 }) });
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Banking:Post") });
    expect(runRuleEngine).not.toHaveBeenCalled();
  });

  it("an unauthenticated request is refused before any permission check", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(401);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(runRuleEngine).not.toHaveBeenCalled();
  });
});
