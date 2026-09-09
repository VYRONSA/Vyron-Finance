import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/merge-service", () => ({
  mergeSuppliers: vi.fn(),
  ValidationError: class ValidationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));

import { POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { mergeSuppliers, ValidationError, NotFoundError } from "@/server/services/merge-service";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function req(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("alice@vyron.test");
  vi.mocked(mergeSuppliers).mockReset();
});

describe("POST .../suppliers/merge (Phase 33A)", () => {
  it("requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await POST(req({ survivingSupplierId: 1, duplicateSupplierId: 2 }), params("co_1"));
    expect(response.status).toBe(401);
    expect(mergeSuppliers).not.toHaveBeenCalled();
  });

  it("requires Matching:Edit permission", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(req({ survivingSupplierId: 1, duplicateSupplierId: 2 }), params("co_1"));
    expect(response.status).toBe(403);
    expect(mergeSuppliers).not.toHaveBeenCalled();
  });

  it("calls mergeSuppliers with the ids from the request body and the performed-by label, returns 200 with the result", async () => {
    vi.mocked(mergeSuppliers).mockResolvedValue({
      survivingSupplierId: 1, survivingSupplierName: "Acme", survivingSupplierCode: "SUP-1",
      mergedSupplierId: 2, mergedSupplierName: "Acme (dup)", mergedSupplierCode: "",
      recordsRepointed: { bills: 0, bankTransactions: 0, purchaseOrders: 0, goodsReceivedNotes: 0, payments: 0, stockItems: 0, merchants: 0, bankTransactionSplits: 0, fixedAssets: 0, openingBalanceEntries: 0, supplierContacts: 0, supplierAddresses: 0 },
      totalRecordsRepointed: 0,
      duplicateStatus: "Inactive",
    });

    const response = await POST(req({ survivingSupplierId: 1, duplicateSupplierId: 2 }), params("co_1"));
    const body = await response.json();

    expect(mergeSuppliers).toHaveBeenCalledWith("co_1", 1, 2, "alice@vyron.test");
    expect(response.status).toBe(200);
    expect(body.result.survivingSupplierId).toBe(1);
    expect(body.result.duplicateStatus).toBe("Inactive");
  });

  it("maps a ValidationError to 400 with the real message — never a raw 500", async () => {
    vi.mocked(mergeSuppliers).mockRejectedValue(new ValidationError("Cannot merge a supplier into itself."));
    const response = await POST(req({ survivingSupplierId: 1, duplicateSupplierId: 1 }), params("co_1"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("Cannot merge a supplier into itself.");
  });

  it("maps a NotFoundError to 404", async () => {
    vi.mocked(mergeSuppliers).mockRejectedValue(new NotFoundError("No supplier with id 999."));
    const response = await POST(req({ survivingSupplierId: 1, duplicateSupplierId: 999 }), params("co_1"));
    expect(response.status).toBe(404);
  });
});
