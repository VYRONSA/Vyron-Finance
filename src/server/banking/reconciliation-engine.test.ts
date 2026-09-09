import { describe, expect, it } from "vitest";
import { autoMatchableTransactionIds, buildReconciliationSummary, computeDifference, listOutstandingItems, reconciliationReadiness } from "./reconciliation-engine";
import { transactionPostingStatus } from "@/server/accounting/types";
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
    postedFlag: false,
    postedAt: null,
    postingBatchId: null,
    sourceOccurrence: 1,
    reviewHold: false,
    reviewHoldReason: "",
    reviewHoldBy: null,
    reviewHoldAt: null,
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
  it("only auto-matches outstanding items genuinely posted to the GL", () => {
    const transactions = [transaction({ id: 1, journalId: 5, postedFlag: true }), transaction({ id: 2, journalId: null })];
    expect(autoMatchableTransactionIds(transactions, "2026-05-31")).toEqual([1]);
  });

  // Bank Accounting Posting — a journal existing is not the same as that
  // journal having been posted. Auto-clearing a transaction whose journal
  // is still a Draft would tick it off against a General Ledger entry
  // that does not exist, which is exactly the claim auto-match is
  // supposed to be safe from making.
  it("does not auto-match a transaction whose journal was never posted", () => {
    const transactions = [transaction({ id: 1, journalId: 5, postedFlag: false })];
    expect(autoMatchableTransactionIds(transactions, "2026-05-31")).toEqual([]);
  });
});

describe("computeDifference", () => {
  it("returns statement minus GL balance", () => {
    expect(computeDifference(1000, 950)).toBe(50);
    expect(computeDifference(950, 1000)).toBe(-50);
  });
});

describe("buildReconciliationSummary", () => {
  // `isBalanced` is about the RECONCILIATION (opening + cleared deposits
  // - cleared payments vs. the statement's closing balance), and
  // `glMatchesStatement` is about VYRON's ledger vs. the bank. They are
  // genuinely different questions — a reconciliation can tie perfectly
  // while the GL is behind because transactions have not been posted yet
  // — so the summary reports both rather than conflating them.
  it("is balanced when the cleared items carry the opening balance to the statement's closing balance", () => {
    const summary = buildReconciliationSummary(
      [transaction({ id: 1, debit: 0, credit: 200, reconciliationId: 7, postedFlag: true })],
      "2026-05-31",
      1200,
      1200,
      { statementOpeningBalance: 1000, reconciliationId: 7 },
    );
    expect(summary.reconciledBalance).toBe(1200);
    expect(summary.outOfBalanceBy).toBe(0);
    expect(summary.isBalanced).toBe(true);
    expect(summary.glMatchesStatement).toBe(true);
    expect(summary.difference).toBe(0);
  });

  it("reports the GL comparison separately from the reconciliation itself", () => {
    const summary = buildReconciliationSummary([], "2026-05-31", 1000, 1000);
    expect(summary.difference).toBe(0);
    expect(summary.glMatchesStatement).toBe(true);
    // Nothing cleared and no opening balance: the statement's own
    // closing balance of 1000 is entirely unexplained, and saying so is
    // the honest answer.
    expect(summary.isBalanced).toBe(false);
    expect(summary.outOfBalanceBy).toBe(1000);
    expect(summary.differenceReasons.map((r) => r.amount)).toEqual([1000]);
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

/**
 * Bank Reconciliation — the arithmetic it exists to prove, and the
 * distinction between a transaction that has reached the ledger and one
 * that has additionally been reconciled against a bank statement.
 */
describe("7. bank reconciliation calculates correctly", () => {
  const PERIOD = { periodStart: "2026-03-01", statementOpeningBalance: 10_000, reconciliationId: 7 };

  it("proves opening + cleared deposits - cleared payments = closing balance", () => {
    const transactions = [
      transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 7, postedFlag: true }),
      transaction({ id: 2, transactionDate: "2026-03-11", debit: 400, credit: 0, reconciliationId: 7, postedFlag: true }),
    ];
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 12_100, 12_100, PERIOD);

    expect(summary.clearedDepositsTotal).toBe(2500);
    expect(summary.clearedPaymentsTotal).toBe(400);
    expect(summary.reconciledBalance).toBe(12_100);
    expect(summary.outOfBalanceBy).toBe(0);
    expect(summary.isBalanced).toBe(true);
  });

  it("separates deposits from payments, both cleared and uncleared", () => {
    const transactions = [
      transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 7 }),
      transaction({ id: 2, transactionDate: "2026-03-11", debit: 400, credit: 0, reconciliationId: 7 }),
      transaction({ id: 3, transactionDate: "2026-03-20", debit: 0, credit: 900, reconciliationId: null }),
      transaction({ id: 4, transactionDate: "2026-03-25", debit: 150, credit: 0, reconciliationId: null }),
    ];
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 12_850, 12_850, PERIOD);

    expect(summary.clearedDeposits.map((i) => i.transactionId)).toEqual([1]);
    expect(summary.clearedPayments.map((i) => i.transactionId)).toEqual([2]);
    expect(summary.unreconciledDeposits.map((i) => i.transactionId)).toEqual([3]);
    expect(summary.unreconciledPayments.map((i) => i.transactionId)).toEqual([4]);
    expect(summary.unreconciledDepositsTotal).toBe(900);
    expect(summary.unreconciledPaymentsTotal).toBe(150);
    expect(summary.unreconciledCount).toBe(2);
  });

  it("explains the difference in money terms — the reasons add up to the gap", () => {
    const transactions = [
      transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 7 }),
      transaction({ id: 3, transactionDate: "2026-03-20", debit: 0, credit: 900, reconciliationId: null }),
      transaction({ id: 4, transactionDate: "2026-03-25", debit: 150, credit: 0, reconciliationId: null }),
    ];
    // Statement says 13,250. Cleared so far gives 12,500. The 750 gap is
    // exactly the uncleared 900 deposit less the uncleared 150 payment.
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 13_250, 13_250, PERIOD);

    expect(summary.reconciledBalance).toBe(12_500);
    expect(summary.outOfBalanceBy).toBe(750);
    expect(summary.isBalanced).toBe(false);
    expect(summary.differenceReasons).toEqual([
      { label: "Deposits in this period not yet marked cleared", amount: 900, count: 1 },
      { label: "Payments in this period not yet marked cleared", amount: -150, count: 1 },
    ]);
    expect(summary.differenceReasons.reduce((sum, r) => sum + r.amount, 0)).toBe(summary.outOfBalanceBy);
  });

  it("names an unexplained remainder rather than hiding it inside a rounded total", () => {
    const transactions = [transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 7 })];
    // The statement claims 13,000 but only 12,500 of activity exists —
    // a genuine 500 the imported transactions do not account for.
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 13_000, 13_000, PERIOD);
    expect(summary.outOfBalanceBy).toBe(500);
    expect(summary.differenceReasons).toEqual([
      { label: "Unexplained — the statement's opening/closing balances do not agree with the transactions imported for this period", amount: 500, count: 0 },
    ]);
  });

  it("scopes to the statement period — transactions outside it are not this reconciliation's work", () => {
    const transactions = [
      transaction({ id: 1, transactionDate: "2026-02-20", debit: 0, credit: 5000, reconciliationId: null }), // before the period
      transaction({ id: 2, transactionDate: "2026-03-10", debit: 0, credit: 900, reconciliationId: null }),
      transaction({ id: 3, transactionDate: "2026-04-04", debit: 0, credit: 700, reconciliationId: null }), // after it
    ];
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 10_900, 10_900, PERIOD);
    expect(summary.unreconciledDeposits.map((i) => i.transactionId)).toEqual([2]);
  });

  it("does not ask the accountant to re-reconcile an item settled in an earlier session", () => {
    const transactions = [
      transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 6 }), // a PRIOR reconciliation
      transaction({ id: 2, transactionDate: "2026-03-10", debit: 0, credit: 900, reconciliationId: null }),
    ];
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 10_900, 10_900, PERIOD);
    expect(summary.unreconciledDeposits.map((i) => i.transactionId)).toEqual([2]);
    expect(summary.clearedDeposits).toEqual([]);
  });

  it("reports the GL comparison independently of whether the reconciliation itself balances", () => {
    const transactions = [transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 7, postedFlag: false })];
    // The reconciliation ties perfectly against the statement, but the GL
    // is 2,500 behind because the transaction was never posted. Both
    // facts are reported; neither is allowed to mask the other.
    const summary = buildReconciliationSummary(transactions, "2026-03-31", 12_500, 10_000, PERIOD);
    expect(summary.isBalanced).toBe(true);
    expect(summary.glMatchesStatement).toBe(false);
    expect(summary.difference).toBe(2500);
    expect(summary.unpostedCount).toBe(1);
    expect(summary.unpostedTotal).toBe(2500);
  });

  it("reconciliationReadiness names posting as the fix when the GL is behind", () => {
    const transactions = [transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, reconciliationId: 7, postedFlag: false })];
    const notes = reconciliationReadiness(buildReconciliationSummary(transactions, "2026-03-31", 12_500, 10_000, PERIOD));
    expect(notes.join(" ")).toContain("not posted to the General Ledger");
    expect(notes.join(" ")).toContain("Post them from Transaction Explorer");
  });
});

describe("8. reconciled transactions are distinguishable from merely posted ones", () => {
  it("classifies the four workflow states from real columns", () => {
    expect(transactionPostingStatus(transaction({ suggestedGlAccount: null, isSplit: false }))).toBe("Unprocessed");
    expect(transactionPostingStatus(transaction({ suggestedGlAccount: "800" }))).toBe("Ready to Post");
    expect(transactionPostingStatus(transaction({ suggestedGlAccount: "800", postedFlag: true }))).toBe("Posted");
    expect(transactionPostingStatus(transaction({ suggestedGlAccount: "800", postedFlag: true, reconciliationId: 7 }))).toBe("Reconciled");
  });

  it("a transaction assigned a GL account is Ready to Post, NOT Posted — classifying is not posting", () => {
    const classified = transaction({ suggestedGlAccount: "800", journalId: null, postedFlag: false });
    expect(transactionPostingStatus(classified)).toBe("Ready to Post");
  });

  it("a transaction carrying a Draft journal is still not Posted", () => {
    expect(transactionPostingStatus(transaction({ suggestedGlAccount: "800", journalId: 900, postedFlag: false }))).toBe("Ready to Post");
  });

  it("Reconciled outranks Posted, so the two are never confused in a listing", () => {
    const posted = transaction({ id: 1, suggestedGlAccount: "800", postedFlag: true, reconciliationId: null });
    const reconciled = transaction({ id: 2, suggestedGlAccount: "800", postedFlag: true, reconciliationId: 7 });
    expect([posted, reconciled].map(transactionPostingStatus)).toEqual(["Posted", "Reconciled"]);
  });

  it("a posted-but-unreconciled transaction is still outstanding work for the reconciliation", () => {
    const posted = transaction({ id: 1, transactionDate: "2026-03-05", debit: 0, credit: 2500, postedFlag: true, reconciliationId: null });
    const summary = buildReconciliationSummary([posted], "2026-03-31", 12_500, 12_500, { periodStart: "2026-03-01", statementOpeningBalance: 10_000, reconciliationId: 7 });
    expect(summary.unreconciledDeposits.map((i) => i.transactionId)).toEqual([1]);
    expect(summary.unreconciledDeposits[0].isPosted).toBe(true);
    expect(summary.unpostedCount).toBe(0);
    // Auto-match is willing to clear it precisely BECAUSE it is posted.
    expect(autoMatchableTransactionIds([posted], "2026-03-31")).toEqual([1]);
  });
});
