/**
 * Bulk Unpost (migration 0120) — what an unposted transaction was allocated
 * to (GL, customer or supplier) stays visible beside it while it has no
 * allocation, and is only ever chosen again when the accountant asks.
 */
import { describe, expect, it } from "vitest";
import { initialEdit, retainedAllocationFor } from "./transaction-grid";
import { bankTransactionFromRow } from "@/server/accounting/mappers";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-03-01", reference: "R", description: "Receipt", beneficiary: "Acme",
    debit: 0, credit: 200, balance: null, bankAccount: "MAIN", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-03-01T00:00:00Z", allocationStatus: "Unallocated",
    matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [],
    matchReason: "", requiredAction: null, suggestedGlAccount: null, suggestedVatCode: "S15", allocationMethod: null,
    allocationReason: "", isManualOverride: true, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null,
    allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null, reconciliationId: null,
    reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1,
    reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null, retainedGlAccount: null,
    retainedCustomerId: null, retainedSupplierId: null,
    ...overrides,
  };
}

const COA = [{ accountCode: "6100", description: "Bank Charges" }] as ChartOfAccount[];
const CUSTOMERS = [{ id: 7, name: "Acme", customerCode: "CUST-001" }];
const SUPPLIERS = [{ id: 8, name: "Supplies Co" }];

describe("retainedAllocationFor", () => {
  it("shows a retained customer by code and name, and offers it as a Customer allocation", () => {
    const t = txn({ retainedCustomerId: 7 });
    expect(retainedAllocationFor(t, initialEdit(t), COA, SUPPLIERS, CUSTOMERS)).toEqual({
      label: "customer CUST-001 — Acme",
      patch: { type: "C", accountCode: "", supplierId: null, customerId: 7 },
    });
  });

  it("shows a retained supplier and offers it as a Supplier allocation", () => {
    const t = txn({ retainedSupplierId: 8, debit: 300, credit: 0 });
    expect(retainedAllocationFor(t, initialEdit(t), COA, SUPPLIERS, CUSTOMERS)).toEqual({
      label: "supplier Supplies Co",
      patch: { type: "S", accountCode: "", supplierId: 8, customerId: null },
    });
  });

  it("shows a retained GL account and offers it as a GL allocation", () => {
    const t = txn({ retainedGlAccount: "6100" });
    expect(retainedAllocationFor(t, initialEdit(t), COA, SUPPLIERS, CUSTOMERS)).toEqual({
      label: "6100 — Bank Charges",
      patch: { type: "G", accountCode: "6100", supplierId: null, customerId: null },
    });
  });

  it("is not applied by itself: the row's own edit stays empty until someone chooses", () => {
    const edit = initialEdit(txn({ retainedCustomerId: 7 }));
    expect(edit.type).toBeNull();
    expect(edit.customerId).toBeNull();
  });

  it("disappears once the transaction is allocated again, or while an allocation is being entered", () => {
    const allocated = txn({ retainedCustomerId: 7, allocationStatus: "Allocated", allocationType: "C", matchedCustomerId: 7 });
    expect(retainedAllocationFor(allocated, initialEdit(allocated), COA, SUPPLIERS, CUSTOMERS)).toBeNull();
    const t = txn({ retainedCustomerId: 7 });
    expect(retainedAllocationFor(t, { ...initialEdit(t), type: "G", accountCode: "6100" }, COA, SUPPLIERS, CUSTOMERS)).toBeNull();
  });

  it("still names a customer that is no longer in the list by its id", () => {
    const t = txn({ retainedCustomerId: 99 });
    expect(retainedAllocationFor(t, initialEdit(t), COA, SUPPLIERS, CUSTOMERS)?.label).toBe("customer #99");
  });

  it("shows nothing for a transaction with nothing retained", () => {
    const t = txn();
    expect(retainedAllocationFor(t, initialEdit(t), COA, SUPPLIERS, CUSTOMERS)).toBeNull();
  });
});

describe("bankTransactionFromRow", () => {
  it("reads retained_customer_id / retained_supplier_id, and treats their absence (a row read before 0120) as none", () => {
    const base = { rules_triggered: [], debit: 0, credit: 0 } as unknown as Parameters<typeof bankTransactionFromRow>[0];
    const read = bankTransactionFromRow({ ...base, retained_customer_id: 7, retained_supplier_id: 8 });
    expect(read.retainedCustomerId).toBe(7);
    expect(read.retainedSupplierId).toBe(8);
    expect(bankTransactionFromRow(base).retainedCustomerId).toBeNull();
    expect(bankTransactionFromRow(base).retainedSupplierId).toBeNull();
  });
});
