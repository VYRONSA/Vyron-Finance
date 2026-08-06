/**
 * Pilot Review Round 1 — PDF Bank Statement Import, Product Review
 * Board's Final Outstanding Requirement. Pure, bank-agnostic validation
 * of an already-extracted statement (metadata + transactions) — nothing
 * here reads a PDF or knows a single bank's layout, so all of it is
 * buildable and testable today regardless of which/how many banks have
 * a real parser yet. Required checks: opening balance, closing balance,
 * running balances, missing transactions, invalid values, duplicate
 * statements, duplicate transactions. Duplicate detection against the
 * database lives in `import-repository.ts`/`import-service.ts` — this
 * module is the pure arithmetic/shape-checking core only.
 */

import type { BankStatementMetadata, ParsedBankTransaction } from "./types";

const ROUNDING_TOLERANCE = 0.01;

export type BalanceReconciliationResult = {
  /** `null` when there isn't enough data to check (no opening or closing
   * balance on the statement) — never a false "true". */
  reconciles: boolean | null;
  expectedClosingBalance: number | null;
  delta: number | null;
};

/** openingBalance + sum(credits) - sum(debits) should equal
 * closingBalance, within rounding tolerance. */
export function reconcileStatementBalances(metadata: BankStatementMetadata, transactions: ParsedBankTransaction[]): BalanceReconciliationResult {
  if (metadata.openingBalance === null || metadata.closingBalance === null) {
    return { reconciles: null, expectedClosingBalance: null, delta: null };
  }
  const totalCredits = transactions.reduce((sum, t) => sum + t.credit, 0);
  const totalDebits = transactions.reduce((sum, t) => sum + t.debit, 0);
  const expectedClosingBalance = metadata.openingBalance + totalCredits - totalDebits;
  const delta = Math.round((expectedClosingBalance - metadata.closingBalance) * 100) / 100;
  return { reconciles: Math.abs(delta) <= ROUNDING_TOLERANCE, expectedClosingBalance, delta };
}

export type RunningBalanceIssue = { rowNumber: number; expectedBalance: number; statedBalance: number };

/** Walks the transactions in order, carrying a running balance from
 * `openingBalance`, and flags any row whose own stated `balance` doesn't
 * match what the running total says it should be. Rows with no stated
 * balance are skipped (nothing to check), not flagged. */
export function validateRunningBalances(openingBalance: number | null, transactions: ParsedBankTransaction[]): RunningBalanceIssue[] {
  if (openingBalance === null) return [];
  const issues: RunningBalanceIssue[] = [];
  let running = openingBalance;
  for (const txn of transactions) {
    running = Math.round((running + txn.credit - txn.debit) * 100) / 100;
    if (txn.balance !== null) {
      const delta = Math.round((running - txn.balance) * 100) / 100;
      if (Math.abs(delta) > ROUNDING_TOLERANCE) {
        issues.push({ rowNumber: txn.rowNumber, expectedBalance: running, statedBalance: txn.balance });
      }
      // Trust the statement's own stated balance going forward, the same
      // way a human reconciling by hand would — one bad row shouldn't
      // cascade into flagging every row after it as well.
      running = txn.balance;
    }
  }
  return issues;
}

export type TransactionCountValidation = {
  /** `null` when the statement's own parser didn't supply an expected
   * count to check against (most banks won't have one) — never a false
   * "true". */
  reconciles: boolean | null;
  expectedCount: number | null;
  actualCount: number;
};

/** Cross-checks the number of transactions actually extracted against
 * an expected count the statement's own parser may supply (e.g. FNB's
 * printed "Turnover for Statement Period" transaction counts) — the
 * "missing transactions" check. Bank-agnostic: the expected count is
 * just a number handed in, not derived from any bank-specific text
 * here. */
export function validateTransactionCount(expectedCount: number | null, transactions: ParsedBankTransaction[]): TransactionCountValidation {
  const actualCount = transactions.length;
  if (expectedCount === null) return { reconciles: null, expectedCount: null, actualCount };
  return { reconciles: actualCount === expectedCount, expectedCount, actualCount };
}

export type InvalidValueIssue = { rowNumber: number; reason: string };

/** The "invalid values" check — row-shape problems that a balance/
 * running-balance check wouldn't catch on their own: a missing date, a
 * row with both a debit and a credit (or neither), or a negative
 * amount (this codebase's `debit`/`credit` fields are always meant to
 * be positive magnitudes — direction is which column is populated, not
 * the sign, matching every other parser in this module). */
export function validateTransactionValues(transactions: ParsedBankTransaction[]): InvalidValueIssue[] {
  const issues: InvalidValueIssue[] = [];
  for (const txn of transactions) {
    if (!txn.transactionDate) {
      issues.push({ rowNumber: txn.rowNumber, reason: "Missing or unparseable transaction date" });
      continue;
    }
    if (txn.debit < 0 || txn.credit < 0) {
      issues.push({ rowNumber: txn.rowNumber, reason: "Negative debit/credit amount" });
      continue;
    }
    if (txn.debit > 0 && txn.credit > 0) {
      issues.push({ rowNumber: txn.rowNumber, reason: "Both debit and credit populated on the same row" });
      continue;
    }
    if (txn.debit === 0 && txn.credit === 0) {
      issues.push({ rowNumber: txn.rowNumber, reason: "Zero-value transaction (no debit or credit amount)" });
    }
  }
  return issues;
}

export type StatementValidationResult = {
  balanceReconciliation: BalanceReconciliationResult;
  runningBalanceIssues: RunningBalanceIssue[];
  transactionCount: TransactionCountValidation;
  invalidValueIssues: InvalidValueIssue[];
};

export function validateStatement(metadata: BankStatementMetadata, transactions: ParsedBankTransaction[], expectedTransactionCount: number | null = null): StatementValidationResult {
  return {
    balanceReconciliation: reconcileStatementBalances(metadata, transactions),
    runningBalanceIssues: validateRunningBalances(metadata.openingBalance, transactions),
    transactionCount: validateTransactionCount(expectedTransactionCount, transactions),
    invalidValueIssues: validateTransactionValues(transactions),
  };
}
