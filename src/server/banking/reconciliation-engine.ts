/**
 * Pure Bank Reconciliation engine — no Supabase. Reuses the EXISTING
 * `ae_bank_transactions` object (`BankTransactionRecord`) rather than a
 * parallel "reconciliation line" table — an item is "outstanding" simply
 * because its `reconciliationId` is still null; there is no separate
 * join table to keep in sync.
 *
 * "GL Balance" is deliberately NOT re-derived by summing this table —
 * that would be a duplicated calculation of a figure the real General
 * Ledger already owns. The caller fetches the actual bank GL control
 * account's balance (Trial Balance / Account Activity, already real,
 * already tested) and passes it in here.
 *
 * Auto-matching is a real, honest rule, not a guess: a transaction is
 * auto-matchable only once it already carries a real `journalId` — i.e.
 * it has genuinely been posted to the GL already. A transaction with no
 * journal yet is a real unprocessed item (needs the Rule Engine or a
 * manual "Generate Journal" first) and is surfaced as a real exception,
 * never silently cleared.
 */

import type { BankTransactionRecord } from "@/server/accounting/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type OutstandingItem = {
  transactionId: number;
  transactionDate: string | null;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  hasJournal: boolean;
};

/** Every not-yet-reconciled transaction dated on or before the statement
 * date — includes items carried forward from a prior, still-incomplete
 * period, since "not reconciled yet" is the only condition, not which
 * reconciliation session first surfaced it. */
export function listOutstandingItems(transactions: BankTransactionRecord[], statementDate: string): OutstandingItem[] {
  return transactions
    .filter((t) => t.reconciliationId === null && t.transactionDate !== null && t.transactionDate <= statementDate)
    .map((t) => ({
      transactionId: t.id,
      transactionDate: t.transactionDate,
      description: t.description,
      reference: t.reference,
      debit: t.debit,
      credit: t.credit,
      hasJournal: t.journalId !== null,
    }))
    .sort((a, b) => (a.transactionDate ?? "").localeCompare(b.transactionDate ?? ""));
}

/** The subset of outstanding items honest to auto-clear — already posted
 * to the GL, so ticking them off as reconciled asserts nothing that
 * isn't already true. */
export function autoMatchableTransactionIds(transactions: BankTransactionRecord[], statementDate: string): number[] {
  return listOutstandingItems(transactions, statementDate)
    .filter((item) => item.hasJournal)
    .map((item) => item.transactionId);
}

export function computeDifference(statementClosingBalance: number, glClosingBalance: number): number {
  return round2(statementClosingBalance - glClosingBalance);
}

export type ReconciliationSummary = {
  statementClosingBalance: number;
  glClosingBalance: number;
  difference: number;
  isBalanced: boolean;
  outstandingItems: OutstandingItem[];
  outstandingDepositsTotal: number;
  outstandingPaymentsTotal: number;
  unprocessedCount: number;
};

const BALANCE_TOLERANCE = 0.01;

/** Pure — assembles the full reconciliation picture for one bank account
 * as-of one statement date. */
export function buildReconciliationSummary(transactions: BankTransactionRecord[], statementDate: string, statementClosingBalance: number, glClosingBalance: number): ReconciliationSummary {
  const outstandingItems = listOutstandingItems(transactions, statementDate);
  const difference = computeDifference(statementClosingBalance, glClosingBalance);
  return {
    statementClosingBalance: round2(statementClosingBalance),
    glClosingBalance: round2(glClosingBalance),
    difference,
    isBalanced: Math.abs(difference) <= BALANCE_TOLERANCE,
    outstandingItems,
    outstandingDepositsTotal: round2(outstandingItems.reduce((sum, item) => sum + item.credit, 0)),
    outstandingPaymentsTotal: round2(outstandingItems.reduce((sum, item) => sum + item.debit, 0)),
    unprocessedCount: outstandingItems.filter((item) => !item.hasJournal).length,
  };
}
