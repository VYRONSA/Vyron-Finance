import { describe, expect, it } from "vitest";
import { ALLOCATION_MATCH_THRESHOLD, findAllocationCandidates, receiptRemaining } from "./receipt-allocation-matching-engine";
import type { CustomerReceipt, SalesInvoice } from "@/server/sales/types";

function receipt(overrides: Partial<CustomerReceipt> = {}): CustomerReceipt {
  return {
    id: 1, companyId: "co_1", customerId: 1, bankAccountId: 1, receiptNumber: "REC-0001",
    receiptDate: "2026-06-01", amount: 1000, status: "Posted", journalId: 10, reference: "",
    notes: "", createdAt: "2026-06-01", approvedBy: "System", approvedAt: "2026-06-01", postedAt: "2026-06-01",
    allocations: [], ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "co_1", customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "INV-0001",
    documentType: "Invoice", invoiceDate: "2026-05-28", dueDate: "2026-06-28", vatTreatmentCode: "STD",
    status: "Posted", journalId: 20, subtotal: 869.57, vatAmount: 130.43, total: 1000, outstanding: 1000,
    isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "", createdAt: "2026-05-28",
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedAt: "2026-05-28",
    cancelledBy: null, cancelledAt: null, lines: [], ...overrides,
  };
}

describe("receiptRemaining", () => {
  it("subtracts already-allocated amounts from the receipt total", () => {
    const r = receipt({ amount: 1000, allocations: [{ id: 1, receiptId: 1, invoiceId: 1, amountAllocated: 400, createdAt: "" }] });
    expect(receiptRemaining(r)).toBe(600);
  });
});

describe("findAllocationCandidates", () => {
  it("scores an exact-amount match above the threshold", () => {
    const candidates = findAllocationCandidates([receipt({ amount: 1000 })], [invoice({ outstanding: 1000 })]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBeGreaterThanOrEqual(ALLOCATION_MATCH_THRESHOLD);
    expect(candidates[0].band).toBe("Matched");
    expect(candidates[0].suggestedAmount).toBe(1000);
  });

  it("never proposes a match across different customers", () => {
    const candidates = findAllocationCandidates([receipt({ customerId: 1 })], [invoice({ customerId: 2 })]);
    expect(candidates).toHaveLength(0);
  });

  it("excludes a Draft receipt or a fully-settled invoice", () => {
    const draftReceipt = findAllocationCandidates([receipt({ status: "Draft" })], [invoice()]);
    expect(draftReceipt).toHaveLength(0);
    const settledInvoice = findAllocationCandidates([receipt()], [invoice({ outstanding: 0 })]);
    expect(settledInvoice).toHaveLength(0);
  });

  it("scores a reference match even when the amount differs", () => {
    const candidates = findAllocationCandidates(
      [receipt({ amount: 500, reference: "Payment for INV-0001" })],
      [invoice({ invoiceNumber: "INV-0001", outstanding: 1000 })],
    );
    expect(candidates[0].matchedRules.map((r) => r.id)).toContain("Reference Match");
    expect(candidates[0].band).not.toBe("Unmatched");
  });

  it("sorts candidates by score descending", () => {
    const candidates = findAllocationCandidates(
      [receipt({ id: 1, amount: 1000, reference: "INV-0002" })],
      [
        invoice({ id: 1, invoiceNumber: "INV-0001", outstanding: 1000 }),
        invoice({ id: 2, invoiceNumber: "INV-0002", outstanding: 500 }),
      ],
    );
    expect(candidates[0].invoiceId).toBe(1); // exact amount (50) beats reference-only (40)
  });
});
