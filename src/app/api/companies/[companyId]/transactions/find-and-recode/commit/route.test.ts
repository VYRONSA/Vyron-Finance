/**
 * Phase 23A — permission enforcement and tenant-scoping for the Find &
 * Recode commit route. The service's own logic (batch cap, posted-
 * transaction protection, GL validation) is already covered by
 * `find-and-recode-service.test.ts` — this file focuses on what's unique
 * to the route: auth/permission gating and correct parameter threading.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-service", () => ({
  commitRecode: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { commitRecode, ValidationError } from "@/server/services/find-and-recode-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function commitRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/find-and-recode/commit`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(commitRecode).mockReset().mockResolvedValue({ requested: 1, recoded: 1, skipped: [] });
});

describe("POST find-and-recode/commit — permission enforcement", () => {
  it("requires Banking:Edit — the same permission Transaction Explorer's other mutating actions require", async () => {
    await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-a"));
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Banking:Edit");
  });

  it("an unauthorised user cannot commit a recode even if they could view the interface", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);

    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-a"));

    expect(response.status).toBe(403);
    expect(commitRecode).not.toHaveBeenCalled();
  });

  it("requires a real session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);

    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-a"));

    expect(response.status).toBe(401);
    expect(commitRecode).not.toHaveBeenCalled();
  });
});

describe("POST find-and-recode/commit — tenant isolation", () => {
  it("only ever commits against the requested company's own id", async () => {
    await POST(commitRequest("company-b", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-b"));
    expect(commitRecode).toHaveBeenCalledWith("company-b", { mode: "ids", transactionIds: [501] }, "6200", "Jane Accountant");
  });
});

describe("POST find-and-recode/commit — success and errors", () => {
  it("returns the outcome on success", async () => {
    vi.mocked(commitRecode).mockResolvedValue({ requested: 3, recoded: 2, skipped: [{ transactionId: 9, reason: "Already posted." }] });

    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [1, 2, 9] }, newGlAccountCode: "6200" }), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toEqual({ requested: 3, recoded: 2, skipped: [{ transactionId: 9, reason: "Already posted." }] });
  });

  it("returns 400 with the honest message on a ValidationError (e.g. batch limit exceeded)", async () => {
    vi.mocked(commitRecode).mockRejectedValue(new ValidationError("501 transactions match — Find & Recode allows at most 500 at a time."));

    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [1] }, newGlAccountCode: "6200" }), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("500 at a time");
  });
});
