/**
 * Phase 39, Part 3 — "+ Add Transaction." The route layer's own
 * responsibilities: session/permission gating (mirroring every other
 * mutating Transaction Explorer route) and translating a `ValidationError`
 * into a 400 — the actual field validation is the service's own job,
 * already covered by `transaction-explorer-service.test.ts`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/require-session", () => ({ requireSession: vi.fn(), getPerformedByLabel: vi.fn() }));
vi.mock("@/server/services/permission-service", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/transaction-explorer-service")>();
  return { ...actual, listTransactions: vi.fn(), createManualExplorerTransaction: vi.fn() };
});

import { GET, POST } from "./route";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createManualExplorerTransaction, ValidationError } from "@/server/services/transaction-explorer-service";
import type { BankTransactionRecord } from "@/server/accounting/types";

function params(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}

function createRequest(companyId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/companies/${companyId}/transactions`, { method: "POST", body: JSON.stringify(body) });
}

const validBody = {
  bankAccountId: 1,
  transactionDate: "2026-08-19",
  reference: "REF-1",
  description: "Cash deposit",
  beneficiary: "Walk-in customer",
  debit: 0,
  credit: 250,
  balance: 1000,
  glAccount: "",
  vat: 0,
  notes: "",
  supplierId: null,
  customerId: null,
};

function createdTransaction(): BankTransactionRecord {
  return {
    id: 501, companyId: "company-a", transactionDate: "2026-08-19", reference: "REF-1", description: "Cash deposit", beneficiary: "Walk-in customer",
    debit: 0, credit: 250, balance: 1000, bankAccount: "Main Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-19T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Manual", captureStatus: "Draft", cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
  };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("Jane Accountant");
  vi.mocked(requirePermission).mockReset().mockResolvedValue({ ok: true } as never);
  vi.mocked(createManualExplorerTransaction).mockReset().mockResolvedValue(createdTransaction());
});

describe("POST /transactions — Add Transaction (Phase 39, Part 3)", () => {
  it("requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await POST(createRequest("company-a", validBody), params("company-a"));
    expect(response.status).toBe(401);
    expect(createManualExplorerTransaction).not.toHaveBeenCalled();
  });

  it("requires Banking:Edit permission, same as every other Transaction Explorer write", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const response = await POST(createRequest("company-a", validBody), params("company-a"));
    expect(response.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("company-a", "Banking:Edit");
    expect(createManualExplorerTransaction).not.toHaveBeenCalled();
  });

  it("creates a transaction and returns it on success", async () => {
    const response = await POST(createRequest("company-a", validBody), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transaction).toEqual(createdTransaction());
    expect(createManualExplorerTransaction).toHaveBeenCalledWith(
      "company-a",
      expect.objectContaining({ bankAccountId: 1, debit: 0, credit: 250, balance: 1000, supplierId: null, customerId: null }),
      "Jane Accountant",
    );
  });

  it("converts a ValidationError from the service into a 400, never a 500", async () => {
    vi.mocked(createManualExplorerTransaction).mockRejectedValue(new ValidationError("Enter either a Debit or a Credit amount."));
    const response = await POST(createRequest("company-a", { ...validBody, debit: 0, credit: 0 }), params("company-a"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Enter either a Debit or a Credit amount.");
  });

  it("only ever creates against the requested company's own id", async () => {
    await POST(createRequest("company-b", validBody), params("company-b"));
    expect(createManualExplorerTransaction).toHaveBeenCalledWith("company-b", expect.anything(), "Jane Accountant");
  });
});

describe("GET /transactions — unchanged by Phase 39", () => {
  it("still exists and requires a session", async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    const response = await GET(new Request("http://localhost/api/companies/company-a/transactions"), params("company-a"));
    expect(response.status).toBe(401);
  });
});
