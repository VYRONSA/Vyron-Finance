/**
 * Phase 23A — the preview route mirrors commit's own permission/tenant
 * tests (see commit/route.test.ts) since previewing already reveals real
 * transaction data and requires the same authorization.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-service", () => ({
  previewRecode: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { POST } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { previewRecode } from "@/server/services/find-and-recode-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function previewRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/find-and-recode/preview`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(previewRecode).mockReset().mockResolvedValue({
    matchingCount: 1, eligibleCount: 1, postedCount: 0, estimatedAffectedValue: 100,
    currentAccountBreakdown: [], sample: [], newGlAccount: { accountCode: "6200", description: "Motor Vehicle Expenses" },
  });
});

describe("POST find-and-recode/preview — permission enforcement", () => {
  it("requires Banking:Edit before returning any preview data", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);

    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-a"));

    expect(response.status).toBe(403);
    expect(previewRecode).not.toHaveBeenCalled();
  });
});

describe("POST find-and-recode/preview — tenant isolation and success", () => {
  it("only ever previews against the requested company's own id", async () => {
    await POST(previewRequest("company-b", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-b"));
    expect(previewRecode).toHaveBeenCalledWith("company-b", { mode: "ids", transactionIds: [501] }, "6200");
  });

  it("returns the preview on success — writes nothing (no commit call exists in this route)", async () => {
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newGlAccountCode: "6200" }), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preview.newGlAccount.accountCode).toBe("6200");
  });
});
