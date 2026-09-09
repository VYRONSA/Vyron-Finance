/**
 * Phase 25G — permission enforcement and tenant-scoping for the Find &
 * Recode supplier-commit route. Mirrors `commit/route.test.ts` exactly.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-service", () => ({
  commitSupplierRecode: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { commitSupplierRecode, ValidationError } from "@/server/services/find-and-recode-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function commitRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/find-and-recode/commit-supplier`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(commitSupplierRecode).mockReset().mockResolvedValue({ requested: 1, recoded: 1, skipped: [] });
});

describe("POST find-and-recode/commit-supplier — permission enforcement", () => {
  it("requires Banking:Edit", async () => {
    await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-a"));
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Banking:Edit");
  });

  it("an unauthorised user cannot commit a supplier recode", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-a"));
    expect(response.status).toBe(403);
    expect(commitSupplierRecode).not.toHaveBeenCalled();
  });

  it("requires a real session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-a"));
    expect(response.status).toBe(401);
    expect(commitSupplierRecode).not.toHaveBeenCalled();
  });
});

describe("POST find-and-recode/commit-supplier — tenant isolation", () => {
  it("only ever commits against the requested company's own id", async () => {
    await POST(commitRequest("company-b", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-b"));
    expect(commitSupplierRecode).toHaveBeenCalledWith("company-b", { mode: "ids", transactionIds: [501] }, 7, "Jane Accountant");
  });
});

describe("POST find-and-recode/commit-supplier — success and errors", () => {
  it("returns the outcome on success", async () => {
    vi.mocked(commitSupplierRecode).mockResolvedValue({ requested: 3, recoded: 2, skipped: [{ transactionId: 9, reason: "Already posted." }] });
    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [1, 2, 9] }, newSupplierId: 7 }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.outcome.recoded).toBe(2);
  });

  it("returns 400 with the honest message on a ValidationError", async () => {
    vi.mocked(commitSupplierRecode).mockRejectedValue(new ValidationError("No supplier with id 999 in this company."));
    const response = await POST(commitRequest("company-a", { selection: { mode: "ids", transactionIds: [1] }, newSupplierId: 999 }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("No supplier with id 999");
  });
});
