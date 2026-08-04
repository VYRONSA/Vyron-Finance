import { describe, expect, it } from "vitest";
import { buildCustomerStatement } from "./customer-statement-engine";
import type { CustomerReceipt, SalesInvoice } from "@/server/sales/types";

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "co_1", customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "INV-0001",
    documentType: "Invoice", invoiceDate: "2026-05-01", dueDate: "2026-06-01", vatTreatmentCode: "STD",
    status: "Posted", journalId: 20, subtotal: 869.57, vatAmount: 130.43, total: 1000, outstanding: 1000,
    isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "", createdAt: "2026-05-01",
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedAt: "2026-05-01",
    cancelledBy: null, cancelledAt: null, lines: [], ...overrides,
  };
}

function receipt(overrides: Partial<CustomerReceipt> = {}): CustomerReceipt {
  return {
    id: 1, companyId: "co_1", customerId: 1, bankAccountId: 1, receiptNumber: "REC-0001",
    receiptDate: "2026-05-10", amount: 400, status: "Posted", journalId: 10, reference: "",
    notes: "", createdAt: "2026-05-10", approvedBy: "System", approvedAt: "2026-05-10", postedAt: "2026-05-10",
    allocations: [], ...overrides,
  };
}

describe("buildCustomerStatement", () => {
  it("builds a running balance across an invoice and a partial receipt", () => {
    const entries = buildCustomerStatement([invoice({ total: 1000 })], [receipt({ amount: 400 })]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: "Invoice", debit: 1000, credit: 0, balance: 1000 });
    expect(entries[1]).toMatchObject({ type: "Receipt", debit: 0, credit: 400, balance: 600 });
  });

  it("negates a Credit Note against the running balance", () => {
    const entries = buildCustomerStatement(
      [invoice({ id: 1, total: 1000, invoiceDate: "2026-05-01" }), invoice({ id: 2, documentType: "Credit Note", total: 200, invoiceDate: "2026-05-05" })],
      [],
    );
    expect(entries[1]).toMatchObject({ type: "Credit Note", debit: 0, credit: 200, balance: 800 });
  });

  it("excludes unposted invoices and receipts", () => {
    const entries = buildCustomerStatement([invoice({ status: "Draft" })], [receipt({ status: "Draft" })]);
    expect(entries).toHaveLength(0);
  });

  it("orders entries chronologically regardless of input order", () => {
    const entries = buildCustomerStatement(
      [invoice({ id: 1, invoiceDate: "2026-05-20" })],
      [receipt({ id: 1, receiptDate: "2026-05-05" })],
    );
    expect(entries.map((e) => e.type)).toEqual(["Receipt", "Invoice"]);
  });
});
