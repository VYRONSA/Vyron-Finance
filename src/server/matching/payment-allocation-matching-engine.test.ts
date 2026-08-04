import { describe, expect, it } from "vitest";
import { ALLOCATION_MATCH_THRESHOLD, findPaymentAllocationCandidates, paymentRemaining } from "./payment-allocation-matching-engine";
import type { SupplierPayment } from "@/server/purchasing/types";
import type { ImportedBill } from "@/server/accounting/types";

function payment(overrides: Partial<SupplierPayment> = {}): SupplierPayment {
  return {
    id: 1, companyId: "co_1", supplierId: 1, bankAccountId: 1, paymentNumber: "PAY-0001",
    paymentDate: "2026-06-01", amount: 1000, status: "Posted", journalId: 10, reference: "",
    notes: "", createdAt: "2026-06-01", approvedBy: "System", approvedAt: "2026-06-01", postedAt: "2026-06-01",
    allocations: [], ...overrides,
  };
}

function bill(overrides: Partial<ImportedBill> = {}): ImportedBill {
  return {
    id: 1, companyId: "co_1", supplierId: 1, supplierName: "Acme Supplies", invoiceNumber: "BILL-0001",
    documentType: "Bill", invoiceDate: "2026-05-28", dueDate: "2026-06-28", vat: 130.43, total: 1000,
    outstanding: 1000, status: "Posted", glAccount: null, vatCode: null, origin: "Purchasing",
    purchaseOrderId: null, goodsReceivedNoteId: null, postingStatus: null, journalId: 20,
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedAt: "2026-05-28",
    cancelledBy: null, cancelledAt: null, ...overrides,
  };
}

describe("paymentRemaining", () => {
  it("subtracts already-allocated amounts from the payment total", () => {
    const p = payment({ amount: 1000, allocations: [{ id: 1, paymentId: 1, billId: 1, amountAllocated: 250, createdAt: "" }] });
    expect(paymentRemaining(p)).toBe(750);
  });
});

describe("findPaymentAllocationCandidates", () => {
  it("scores an exact-amount match above the threshold", () => {
    const candidates = findPaymentAllocationCandidates([payment({ amount: 1000 })], [bill({ outstanding: 1000 })]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBeGreaterThanOrEqual(ALLOCATION_MATCH_THRESHOLD);
    expect(candidates[0].band).toBe("Matched");
    expect(candidates[0].suggestedAmount).toBe(1000);
  });

  it("never proposes a match across different suppliers", () => {
    const candidates = findPaymentAllocationCandidates([payment({ supplierId: 1 })], [bill({ supplierId: 2 })]);
    expect(candidates).toHaveLength(0);
  });

  it("excludes a bill with no supplier or already fully settled", () => {
    const noSupplier = findPaymentAllocationCandidates([payment()], [bill({ supplierId: null })]);
    expect(noSupplier).toHaveLength(0);
    const settled = findPaymentAllocationCandidates([payment()], [bill({ outstanding: 0 })]);
    expect(settled).toHaveLength(0);
  });

  it("scores a reference match even when the amount differs", () => {
    const candidates = findPaymentAllocationCandidates(
      [payment({ amount: 500, reference: "Settling BILL-0001" })],
      [bill({ invoiceNumber: "BILL-0001", outstanding: 1000 })],
    );
    expect(candidates[0].matchedRules.map((r) => r.id)).toContain("Reference Match");
  });
});
