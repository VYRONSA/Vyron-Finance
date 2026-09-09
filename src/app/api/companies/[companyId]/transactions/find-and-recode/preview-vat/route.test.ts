/**
 * Phase 25G — permission enforcement and tenant-scoping for the Find &
 * Recode VAT-preview route. Mirrors `preview/route.test.ts` exactly.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/find-and-recode-service", () => ({
  previewVatRecode: vi.fn(),
  ValidationError: class ValidationError extends Error {},
}));

import { POST } from "./route";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { previewVatRecode, ValidationError } from "@/server/services/find-and-recode-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function previewRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions/find-and-recode/preview-vat`, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(previewVatRecode).mockReset().mockResolvedValue({
    matchingCount: 1, eligibleCount: 1, postedCount: 0, estimatedAffectedValue: 100,
    currentVatBreakdown: [], sample: [], newVatTreatment: { code: "STD", name: "Standard Rated" },
  });
});

describe("POST find-and-recode/preview-vat — permission enforcement", () => {
  it("requires Banking:Edit before returning any preview data", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newVatCode: "STD" }), params("company-a"));
    expect(response.status).toBe(403);
    expect(previewVatRecode).not.toHaveBeenCalled();
  });

  it("requires a real session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newVatCode: "STD" }), params("company-a"));
    expect(response.status).toBe(401);
    expect(previewVatRecode).not.toHaveBeenCalled();
  });
});

describe("POST find-and-recode/preview-vat — tenant isolation and success", () => {
  it("only ever previews against the requested company's own id", async () => {
    await POST(previewRequest("company-b", { selection: { mode: "ids", transactionIds: [501] }, newVatCode: "STD" }), params("company-b"));
    expect(previewVatRecode).toHaveBeenCalledWith("company-b", { mode: "ids", transactionIds: [501] }, "STD");
  });

  it("returns the preview on success — writes nothing", async () => {
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newVatCode: "STD" }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preview.newVatTreatment.code).toBe("STD");
  });

  it("returns 400 with the honest message on a ValidationError", async () => {
    vi.mocked(previewVatRecode).mockRejectedValue(new ValidationError("No VAT treatment with code 'BOGUS'."));
    const response = await POST(previewRequest("company-a", { selection: { mode: "ids", transactionIds: [501] }, newVatCode: "BOGUS" }), params("company-a"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("No VAT treatment");
  });
});
