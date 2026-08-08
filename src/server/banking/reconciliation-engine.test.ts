import { describe, expect, it } from "vitest";
import { autoMatchableTransactionIds, buildReconciliationSummary, computeDifference, listOutstandingItems } from "./reconciliation-engine";
import type { BankTransactionRecord } from "@/server/accounting/types";

function transaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-05-15", reference: "REF1", description: "Payment", beneficiary: "",
    debit: 0, credit: 100, balance: null, bankAccount: "1000", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-05-15T00:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null, suggestedGlAccount: null,
    suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null,
    matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "",
    entrySource: "Imported", captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

describe("listOutstandingItems", () => {
  it("includes only unreconciled transactions dated on or before the statement date", () => {
    const transactions = [
      transaction({ id: 1, transactionDate: "2026-05-10", reconciliationId: null }),
      transaction({ id: 2, transactionDate: "2026-05-20", reconciliationId: null }), // after statement date
      transaction({ id: 3, transactionDate: "2026-05-10", reconciliationId: 99 }), // already reconciled
    ];
    const outstanding = listOutstandingItems(transactions, "2026-05-15");
    expect(outstanding.map((i) => i.transactionId)).toEqual([1]);
  });

  it("carries forward items from a prior, still-incomplete period", () => {
    const transactions = [transaction({ id: 1, transactionDate: "2026-04-01", reconciliationId: null })];
    const outstanding = listOutstandingItems(transactions, "2026-05-31");
    expect(outstanding).toHaveLength(1);
  });

  it("flags whether each outstanding item already has a real journal", () => {
    const transactions = [transaction({ id: 1, journalId: 5 }), transaction({ id: 2, journalId: null })];
    const outstanding = listOutstandingItems(transactions, "2026-05-31");
    expect(outstanding.find((i) => i.transactionId === 1)?.hasJournal).toBe(true);
    expect(outstanding.find((i) => i.transactionId === 2)?.hasJournal).toBe(false);
  });
});

describe("autoMatchableTransactionIds", () => {
  it("only auto-matches outstanding items that are already posted to the GL", () => {
    const transactions = [transaction({ id: 1, journalId: 5 }), transaction({ id: 2, journalId: null })];
    expect(autoMatchableTransactionIds(transactions, "2026-05-31")).toEqual([1]);
  });
});

describe("computeDifference", () => {
  it("returns statement minus GL balance", () => {
    expect(computeDifference(1000, 950)).toBe(50);
    expect(computeDifference(950, 1000)).toBe(-50);
  });
});

describe("buildReconciliationSummary", () => {
  it("is balanced when statement and GL balances tie within tolerance", () => {
    const summary = buildReconciliationSummary([], "2026-05-31", 1000, 1000);
    expect(summary.isBalanced).toBe(true);
    expect(summary.difference).toBe(0);
  });

  it("computes outstanding deposits/payments totals and an unprocessed count", () => {
    const transactions = [
      transaction({ id: 1, debit: 0, credit: 200, journalId: 5 }), // outstanding deposit, already journaled
      transaction({ id: 2, debit: 150, credit: 0, journalId: null }), // outstanding payment, unprocessed
    ];
    const summary = buildReconciliationSummary(transactions, "2026-05-31", 1000, 950);
    expect(summary.outstandingDepositsTotal).toBe(200);
    expect(summary.outstandingPaymentsTotal).toBe(150);
    expect(summary.unprocessedCount).toBe(1);
    expect(summary.isBalanced).toBe(false);
  });
});
