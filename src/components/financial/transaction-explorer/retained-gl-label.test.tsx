/**
 * Bulk Unallocate (migration 0119) — the GL account a bulk-unallocated
 * transaction had stays visible beside it, but only while it truly has no
 * allocation, and it never becomes one.
 */
import { describe, expect, it } from "vitest";
import { initialEdit, retainedGlLabel } from "./transaction-grid";
import { bankTransactionFromRow } from "@/server/accounting/mappers";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-03-01", reference: "R", description: "Fee", beneficiary: "Bank",
    debit: 10, credit: 0, balance: null, bankAccount: "MAIN", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-03-01T00:00:00Z", allocationStatus: "Unallocated",
    matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [],
    matchReason: "", requiredAction: null, suggestedGlAccount: null, suggestedVatCode: "S15", allocationMethod: null,
    allocationReason: "", isManualOverride: true, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null,
    allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null, reconciliationId: null,
    reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1,
    reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null, retainedGlAccount: "6100",
    ...overrides,
  };
}

const COA = [{ accountCode: "6100", description: "Bank Charges" }] as ChartOfAccount[];

describe("retainedGlLabel", () => {
  it("shows the retained GL code and name beside an unallocated transaction", () => {
    const t = txn();
    expect(retainedGlLabel(t, initialEdit(t), COA)).toBe("6100 — Bank Charges");
  });

  it("does not pre-fill the allocation editor — the row stays unallocated until someone chooses", () => {
    const edit = initialEdit(txn());
    expect(edit.type).toBeNull();
    expect(edit.accountCode).toBe("");
  });

  it("disappears once the transaction is allocated again, or while an allocation is being entered", () => {
    const allocated = txn({ allocationStatus: "Allocated", suggestedGlAccount: "6200", allocationType: "G" });
    expect(retainedGlLabel(allocated, initialEdit(allocated), COA)).toBeNull();
    const t = txn();
    expect(retainedGlLabel(t, { ...initialEdit(t), type: "G", accountCode: "6200" }, COA)).toBeNull();
  });

  it("shows the bare code when the account is no longer in the chart", () => {
    const t = txn({ retainedGlAccount: "9999" });
    expect(retainedGlLabel(t, initialEdit(t), COA)).toBe("9999");
  });

  it("shows nothing for a transaction that was never bulk-unallocated", () => {
    const t = txn({ retainedGlAccount: null });
    expect(retainedGlLabel(t, initialEdit(t), COA)).toBeNull();
  });
});

describe("bankTransactionFromRow", () => {
  it("reads retained_gl_account, and treats its absence (a row read before 0119) as none", () => {
    const base = { rules_triggered: [], debit: 0, credit: 0 } as unknown as Parameters<typeof bankTransactionFromRow>[0];
    expect(bankTransactionFromRow({ ...base, retained_gl_account: "6100" }).retainedGlAccount).toBe("6100");
    expect(bankTransactionFromRow(base).retainedGlAccount).toBeNull();
  });
});
