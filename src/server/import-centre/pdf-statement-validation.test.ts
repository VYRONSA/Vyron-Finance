import { describe, expect, it } from "vitest";
import { reconcileStatementBalances, validateRunningBalances, validateStatement } from "./pdf-statement-validation";
import { NULL_STATEMENT_METADATA, type ParsedBankTransaction } from "./types";

function txn(overrides: Partial<ParsedBankTransaction>): ParsedBankTransaction {
  return {
    transactionDate: "2026-01-05",
    reference: "REF1",
    description: "Test transaction",
    beneficiary: "Test Beneficiary",
    debit: 0,
    credit: 0,
    balance: null,
    bankAccount: "12345678",
    vat: null,
    glAccount: "",
    notes: "",
    sourceFilename: "statement.pdf",
    importBatch: "BATCH-1",
    rowNumber: 1,
    ...overrides,
  };
}

describe("reconcileStatementBalances", () => {
  it("returns null when the statement has no opening/closing balance", () => {
    const result = reconcileStatementBalances(NULL_STATEMENT_METADATA, []);
    expect(result.reconciles).toBeNull();
    expect(result.expectedClosingBalance).toBeNull();
  });

  it("passes when opening + credits - debits equals closing", () => {
    const metadata = { ...NULL_STATEMENT_METADATA, openingBalance: 1000, closingBalance: 1300 };
    const transactions = [txn({ credit: 500, rowNumber: 1 }), txn({ debit: 200, rowNumber: 2 })];
    const result = reconcileStatementBalances(metadata, transactions);
    expect(result.reconciles).toBe(true);
    expect(result.expectedClosingBalance).toBe(1300);
    expect(result.delta).toBe(0);
  });

  it("fails and reports the exact delta when the statement's closing balance doesn't match", () => {
    const metadata = { ...NULL_STATEMENT_METADATA, openingBalance: 1000, closingBalance: 1400 };
    const transactions = [txn({ credit: 500 }), txn({ debit: 200 })];
    const result = reconcileStatementBalances(metadata, transactions);
    expect(result.reconciles).toBe(false);
    expect(result.delta).toBe(-100);
  });

  it("tolerates sub-cent rounding noise", () => {
    const metadata = { ...NULL_STATEMENT_METADATA, openingBalance: 100, closingBalance: 100.005 };
    const result = reconcileStatementBalances(metadata, []);
    expect(result.reconciles).toBe(true);
  });
});

describe("validateRunningBalances", () => {
  it("returns no issues when there is no opening balance to check against", () => {
    expect(validateRunningBalances(null, [txn({ credit: 100, balance: 999 })])).toEqual([]);
  });

  it("returns no issues when every row's stated balance matches the running total", () => {
    const transactions = [txn({ credit: 500, balance: 1500, rowNumber: 1 }), txn({ debit: 200, balance: 1300, rowNumber: 2 })];
    expect(validateRunningBalances(1000, transactions)).toEqual([]);
  });

  it("flags a row whose stated balance disagrees with the running total", () => {
    const transactions = [txn({ credit: 500, balance: 1600, rowNumber: 1 })];
    const issues = validateRunningBalances(1000, transactions);
    expect(issues).toEqual([{ rowNumber: 1, expectedBalance: 1500, statedBalance: 1600 }]);
  });

  it("re-anchors on the statement's own stated balance so one bad row doesn't cascade", () => {
    const transactions = [
      txn({ credit: 500, balance: 1600, rowNumber: 1 }), // wrong, flagged, but we trust it going forward
      txn({ debit: 100, balance: 1500, rowNumber: 2 }), // 1600 - 100 = 1500, consistent with row 1's stated balance
    ];
    const issues = validateRunningBalances(1000, transactions);
    expect(issues).toEqual([{ rowNumber: 1, expectedBalance: 1500, statedBalance: 1600 }]);
  });

  it("skips rows with no stated balance", () => {
    const transactions = [txn({ credit: 500, balance: null, rowNumber: 1 })];
    expect(validateRunningBalances(1000, transactions)).toEqual([]);
  });
});

describe("validateStatement", () => {
  it("composes both checks", () => {
    const metadata = { ...NULL_STATEMENT_METADATA, openingBalance: 1000, closingBalance: 1500 };
    const transactions = [txn({ credit: 500, balance: 1500, rowNumber: 1 })];
    const result = validateStatement(metadata, transactions);
    expect(result.balanceReconciliation.reconciles).toBe(true);
    expect(result.runningBalanceIssues).toEqual([]);
  });
});
