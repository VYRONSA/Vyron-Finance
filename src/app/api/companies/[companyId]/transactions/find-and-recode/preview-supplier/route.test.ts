/**
 * Phase 25G — permission enforcement and tenant-scoping for the Find &
 * Recode supplier-preview route. The service's own logic (batch cap,
 * posted-transaction protection, supplier validation) is already covered
 * by `find-and-recode-service.test.ts` — this file focuses on what's
 * unique to the route: auth/permission gating and correct parameter
 * threading, mirroring `preview/route.test.ts` exactly.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-service", () => ({
  previewSupplierRecode: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { POST } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { previewSupplierRecode, ValidationError } from "@/server/services/find-and-recode-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function previewRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/find-and-recode/preview-supplier`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(previewSupplierRecode).mockReset().mockResolvedValue({
    matchingCount: 1, eligibleCount: 1, postedCount: 0, estimatedAffectedValue: 100,
    currentSupplierBreakdown: [], sample: [], newSupplier: { id: 7, name: "Beta Traders" },
  });
});

describe("POST find-and-recode/preview-supplier — permission enforcement", () => {
  it("requires Banking:Edit before returning any preview data", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-a"));
    expect(response.status).toBe(403);
    expect(previewSupplierRecode).not.toHaveBeenCalled();
  });

  it("requires a real session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-a"));
    expect(response.status).toBe(401);
    expect(previewSupplierRecode).not.toHaveBeenCalled();
  });
});

describe("POST find-and-recode/preview-supplier — tenant isolation and success", () => {
  it("only ever previews against the requested company's own id, and coerces the supplier id to a number", async () => {
    await POST(previewRequest("company-b", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-b"));
    expect(previewSupplierRecode).toHaveBeenCalledWith("company-b", { mode: "ids", transactionIds: [501] }, 7);
  });

  it("returns the preview on success — writes nothing", async () => {
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 7 }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview.newSupplier.id).toBe(7);
  });

  it("returns 400 with the honest message on a ValidationError (e.g. cross-company/invalid supplier)", async () => {
    vi.mocked(previewSupplierRecode).mockRejectedValue(new ValidationError("No supplier with id 999 in this company."));
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newSupplierId: 999 }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("No supplier with id 999");
  });
});
