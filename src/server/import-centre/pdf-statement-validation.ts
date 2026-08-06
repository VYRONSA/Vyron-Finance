/**
 * Pilot Review Round 1 — PDF Bank Statement Import, Product Review
 * Board's Final Outstanding Requirement. Pure, bank-agnostic validation
 * of an already-extracted statement (metadata + transactions) — nothing
 * here reads a PDF or knows a single bank's layout, so all of it is
 * buildable and testable today regardless of which/how many banks have
 * a real parser yet. Required checks: opening balance, closing balance,
 * running balances, duplicate statements, duplicate transactions.
 * Duplicate detection against the database lives in
 * `import-repository.ts`/`import-service.ts` — this module is the pure
 * arithmetic core only.
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

export type StatementValidationResult = {
  balanceReconciliation: BalanceReconciliationResult;
  runningBalanceIssues: RunningBalanceIssue[];
};

export function validateStatement(metadata: BankStatementMetadata, transactions: ParsedBankTransaction[]): StatementValidationResult {
  return {
    balanceReconciliation: reconcileStatementBalances(metadata, transactions),
    runningBalanceIssues: validateRunningBalances(metadata.openingBalance, transactions),
  };
}
