import { describe, expect, it } from "vitest";
import { buildSupplierStatement } from "./supplier-statement-engine";
import type { ImportedBill } from "@/server/accounting/types";
import type { SupplierPayment } from "@/server/purchasing/types";

function bill(overrides: Partial<ImportedBill> = {}): ImportedBill {
  return {
    id: 1, companyId: "co_1", supplierId: 1, supplierName: "Acme Supplies", invoiceNumber: "BILL-0001",
    documentType: "Bill", invoiceDate: "2026-05-01", dueDate: "2026-06-01", vat: 130.43, total: 1000,
    outstanding: 1000, status: "Posted", glAccount: null, vatCode: null, origin: "Purchasing",
    purchaseOrderId: null, goodsReceivedNoteId: null, postingStatus: null, journalId: 20,
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedAt: "2026-05-01",
    cancelledBy: null, cancelledAt: null, ...overrides,
  };
}

function payment(overrides: Partial<SupplierPayment> = {}): SupplierPayment {
  return {
    id: 1, companyId: "co_1", supplierId: 1, bankAccountId: 1, paymentNumber: "PAY-0001",
    paymentDate: "2026-05-10", amount: 400, status: "Posted", journalId: 10, reference: "",
    notes: "", createdAt: "2026-05-10", approvedBy: "System", approvedAt: "2026-05-10", postedAt: "2026-05-10",
    allocations: [], ...overrides,
  };
}

describe("buildSupplierStatement", () => {
  it("builds a running balance across a bill and a partial payment", () => {
    const entries = buildSupplierStatement([bill({ total: 1000 })], [payment({ amount: 400 })]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: "Bill", debit: 1000, credit: 0, balance: 1000 });
    expect(entries[1]).toMatchObject({ type: "Payment", debit: 0, credit: 400, balance: 600 });
  });

  it("negates a Credit Note against the running balance", () => {
    const entries = buildSupplierStatement(
      [bill({ id: 1, total: 1000, invoiceDate: "2026-05-01" }), bill({ id: 2, documentType: "Credit Note", total: 200, invoiceDate: "2026-05-05" })],
      [],
    );
    expect(entries[1]).toMatchObject({ type: "Credit Note", debit: 0, credit: 200, balance: 800 });
  });

  it("excludes bills with no real journal (never actually posted)", () => {
    const entries = buildSupplierStatement([bill({ journalId: null })], []);
    expect(entries).toHaveLength(0);
  });

  it("excludes unposted payments", () => {
    const entries = buildSupplierStatement([], [payment({ status: "Draft" })]);
    expect(entries).toHaveLength(0);
  });
});
