/**
 * Pure Bank Reconciliation engine — no Supabase. Reuses the EXISTING
 * `ae_bank_transactions` object (`BankTransactionRecord`) rather than a
 * parallel "reconciliation line" table — an item is "outstanding" simply
 * because its `reconciliationId` is still null; there is no separate
 * join table to keep in sync.
 *
 * The reconciliation proves one identity, and shows its working:
 *
 *   opening balance + cleared deposits - cleared payments = closing balance
 *
 * A reconciliation that does not balance is not an error state to be
 * suppressed — it is the normal, informative middle of the job, so
 * `differenceReasons` names every component of the gap in money terms
 * (uncleared deposits, uncleared payments, transactions not yet posted to
 * the ledger). The accountant can see WHY it is out, not merely that it
 * is.
 *
 * Sign convention throughout, matching the rest of the codebase
 * (`cashbook-service.ts::captureCashbookReceipt` writes a receipt to
 * `credit`): `credit` is money INTO the bank — a deposit; `debit` is
 * money OUT — a payment.
 *
 * "GL Balance" is deliberately NOT re-derived by summing this table —
 * that would be a duplicated calculation of a figure the real General
 * Ledger already owns. The caller fetches the actual bank GL control
 * account's balance (Trial Balance / Account Activity, already real,
 * already tested) and passes it in here.
 *
 * Auto-matching is a real, honest rule, not a guess: a transaction is
 * auto-matchable only once it has genuinely been POSTED to the ledger
 * (`postedFlag`) — not merely journaled, and certainly not merely
 * classified. A transaction with nothing in the ledger behind it is a
 * real unprocessed item and is surfaced as one, never silently cleared.
 */

import { transactionPostingStatus, type BankTransactionRecord } from "@/server/accounting/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const BALANCE_TOLERANCE = 0.01;

export type ReconciliationItem = {
  transactionId: number;
  transactionDate: string | null;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  /** Money in (`credit`) is a deposit; money out (`debit`) is a payment. */
  direction: "Deposit" | "Payment";
  amount: number;
  hasJournal: boolean;
  /** Genuinely in the General Ledger, not merely attached to a journal. */
  isPosted: boolean;
  /** Cleared against THIS reconciliation. */
  isCleared: boolean;
  /** Already reconciled, but in a different (earlier) session. Such an
   * item is settled: it is neither this period's outstanding work nor
   * part of this period's cleared totals. */
  isClearedElsewhere: boolean;
};

/** Kept as the previous name/shape so existing callers and tests of
 * `listOutstandingItems` keep working; `ReconciliationItem` is the richer
 * type everything new uses. */
export type OutstandingItem = Pick<ReconciliationItem, "transactionId" | "transactionDate" | "description" | "reference" | "debit" | "credit" | "hasJournal">;

function toItem(t: BankTransactionRecord, reconciliationId: number | null): ReconciliationItem {
  const isDeposit = t.credit > 0;
  return {
    transactionId: t.id,
    transactionDate: t.transactionDate,
    description: t.description,
    reference: t.reference,
    debit: t.debit,
    credit: t.credit,
    direction: isDeposit ? "Deposit" : "Payment",
    amount: isDeposit ? t.credit : t.debit,
    hasJournal: t.journalId !== null,
    isPosted: t.postedFlag,
    isCleared: reconciliationId !== null && t.reconciliationId === reconciliationId,
    isClearedElsewhere: t.reconciliationId !== null && t.reconciliationId !== reconciliationId,
  };
}

/** Every transaction that falls inside the statement period. When no
 * period start is recorded (a reconciliation created before migration
 * 0092), everything up to the statement date is in scope — the original
 * behaviour, kept rather than guessing a start date. */
export function listPeriodItems(
  transactions: BankTransactionRecord[],
  periodStart: string | null,
  statementDate: string,
  reconciliationId: number | null,
): ReconciliationItem[] {
  return transactions
    .filter((t) => t.transactionDate !== null && t.transactionDate <= statementDate && (periodStart === null || t.transactionDate >= periodStart))
    .map((t) => toItem(t, reconciliationId))
    .sort((a, b) => (a.transactionDate ?? "").localeCompare(b.transactionDate ?? "") || a.transactionId - b.transactionId);
}

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
 * to the General Ledger, so ticking them off asserts nothing that isn't
 * already true. Deliberately keyed on `postedFlag` and not on
 * `journalId`: a transaction can carry a Draft journal that was never
 * posted, and clearing that would claim a ledger entry that doesn't
 * exist. */
export function autoMatchableTransactionIds(transactions: BankTransactionRecord[], statementDate: string): number[] {
  return transactions
    .filter((t) => t.reconciliationId === null && t.transactionDate !== null && t.transactionDate <= statementDate && t.postedFlag)
    .map((t) => t.id);
}

export function computeDifference(statementClosingBalance: number, glClosingBalance: number): number {
  return round2(statementClosingBalance - glClosingBalance);
}

/** One line of the "why doesn't this balance?" explanation. `amount` is
 * signed in the direction it moves the reconciled balance, so the reasons
 * literally add up to the difference. */
export type DifferenceReason = {
  label: string;
  amount: number;
  count: number;
};

export type ReconciliationSummary = {
  periodStart: string | null;
  periodEnd: string;
  statementOpeningBalance: number;
  statementClosingBalance: number;

  /** opening + cleared deposits - cleared payments. What the bank
   * statement says the account should hold, per the items the accountant
   * has actually ticked off. */
  reconciledBalance: number;
  /** statement closing - reconciled balance. Zero means reconciled. */
  outOfBalanceBy: number;
  isBalanced: boolean;

  clearedDeposits: ReconciliationItem[];
  clearedPayments: ReconciliationItem[];
  clearedDepositsTotal: number;
  clearedPaymentsTotal: number;

  /** In-period transactions the accountant has not ticked off yet. */
  unreconciledDeposits: ReconciliationItem[];
  unreconciledPayments: ReconciliationItem[];
  unreconciledDepositsTotal: number;
  unreconciledPaymentsTotal: number;
  unreconciledCount: number;

  /** Named `outstanding*` for continuity with the original engine: every
   * unreconciled item up to the statement date, including ones carried
   * forward from before this period. */
  outstandingItems: OutstandingItem[];
  outstandingDepositsTotal: number;
  outstandingPaymentsTotal: number;

  /** In-period transactions with nothing in the General Ledger behind
   * them — the reconciliation can still be completed, but the GL side of
   * the comparison cannot be right until these are posted. */
  unpostedCount: number;
  unpostedTotal: number;
  /** Retained name — the count of unreconciled items with no journal at
   * all, which is what the original engine reported. */
  unprocessedCount: number;

  glClosingBalance: number;
  /** statement closing - GL closing: VYRON's ledger vs. the bank. */
  difference: number;
  glMatchesStatement: boolean;

  differenceReasons: DifferenceReason[];
};

/** Pure — assembles the full reconciliation picture for one bank account
 * over one statement period. */
export function buildReconciliationSummary(
  transactions: BankTransactionRecord[],
  statementDate: string,
  statementClosingBalance: number,
  glClosingBalance: number,
  options: { periodStart?: string | null; statementOpeningBalance?: number; reconciliationId?: number | null } = {},
): ReconciliationSummary {
  const periodStart = options.periodStart ?? null;
  const openingBalance = round2(options.statementOpeningBalance ?? 0);
  const reconciliationId = options.reconciliationId ?? null;

  const periodItems = listPeriodItems(transactions, periodStart, statementDate, reconciliationId);

  const clearedDeposits = periodItems.filter((i) => i.isCleared && i.direction === "Deposit");
  const clearedPayments = periodItems.filter((i) => i.isCleared && i.direction === "Payment");
  // Items already settled in an EARLIER reconciliation are excluded from
  // both lists: presenting them as this period's outstanding work would
  // ask the accountant to reconcile the same transaction twice, and
  // folding them into this period's cleared totals would double-count
  // them against an opening balance that already reflects them.
  const unreconciledDeposits = periodItems.filter((i) => !i.isCleared && !i.isClearedElsewhere && i.direction === "Deposit");
  const unreconciledPayments = periodItems.filter((i) => !i.isCleared && !i.isClearedElsewhere && i.direction === "Payment");

  const sum = (items: ReconciliationItem[]) => round2(items.reduce((total, i) => total + i.amount, 0));
  const clearedDepositsTotal = sum(clearedDeposits);
  const clearedPaymentsTotal = sum(clearedPayments);
  const unreconciledDepositsTotal = sum(unreconciledDeposits);
  const unreconciledPaymentsTotal = sum(unreconciledPayments);

  const reconciledBalance = round2(openingBalance + clearedDepositsTotal - clearedPaymentsTotal);
  const outOfBalanceBy = round2(statementClosingBalance - reconciledBalance);

  const unposted = periodItems.filter((i) => !i.isPosted);
  const outstandingItems = listOutstandingItems(transactions, statementDate);

  // The reasons are the arithmetic, not a narrative: clearing every
  // outstanding deposit would raise the reconciled balance by its total,
  // clearing every outstanding payment would lower it by its total, and
  // together they account for the whole gap whenever the statement's own
  // figures are right. Anything left over is reported as its own line so
  // an unexplained remainder is never hidden inside a rounded total.
  const differenceReasons: DifferenceReason[] = [];
  if (unreconciledDepositsTotal > 0) {
    differenceReasons.push({
      label: "Deposits in this period not yet marked cleared",
      amount: unreconciledDepositsTotal,
      count: unreconciledDeposits.length,
    });
  }
  if (unreconciledPaymentsTotal > 0) {
    differenceReasons.push({
      label: "Payments in this period not yet marked cleared",
      amount: -unreconciledPaymentsTotal,
      count: unreconciledPayments.length,
    });
  }
  const explained = round2(unreconciledDepositsTotal - unreconciledPaymentsTotal);
  const unexplained = round2(outOfBalanceBy - explained);
  if (Math.abs(unexplained) > BALANCE_TOLERANCE) {
    differenceReasons.push({
      label: "Unexplained — the statement's opening/closing balances do not agree with the transactions imported for this period",
      amount: unexplained,
      count: 0,
    });
  }

  return {
    periodStart,
    periodEnd: statementDate,
    statementOpeningBalance: openingBalance,
    statementClosingBalance: round2(statementClosingBalance),

    reconciledBalance,
    outOfBalanceBy,
    isBalanced: Math.abs(outOfBalanceBy) <= BALANCE_TOLERANCE,

    clearedDeposits,
    clearedPayments,
    clearedDepositsTotal,
    clearedPaymentsTotal,

    unreconciledDeposits,
    unreconciledPayments,
    unreconciledDepositsTotal,
    unreconciledPaymentsTotal,
    unreconciledCount: unreconciledDeposits.length + unreconciledPayments.length,

    outstandingItems,
    outstandingDepositsTotal: round2(outstandingItems.reduce((total, i) => total + i.credit, 0)),
    outstandingPaymentsTotal: round2(outstandingItems.reduce((total, i) => total + i.debit, 0)),

    unpostedCount: unposted.length,
    unpostedTotal: sum(unposted),
    unprocessedCount: outstandingItems.filter((i) => !i.hasJournal).length,

    glClosingBalance: round2(glClosingBalance),
    difference: computeDifference(statementClosingBalance, glClosingBalance),
    glMatchesStatement: Math.abs(computeDifference(statementClosingBalance, glClosingBalance)) <= BALANCE_TOLERANCE,

    differenceReasons,
  };
}

/** Convenience for the UI's "what still needs doing before this
 * reconciliation can be trusted?" list — real blockers only, never a
 * reason to alter a transaction. */
export function reconciliationReadiness(summary: ReconciliationSummary): string[] {
  const notes: string[] = [];
  if (summary.unpostedCount > 0) {
    notes.push(
      `${summary.unpostedCount} transaction${summary.unpostedCount === 1 ? " is" : "s are"} not posted to the General Ledger yet, so the GL Balance below does not include ${summary.unpostedTotal.toFixed(2)} of activity. Post them from Transaction Explorer.`,
    );
  }
  if (summary.unreconciledCount > 0) {
    notes.push(`${summary.unreconciledCount} transaction${summary.unreconciledCount === 1 ? "" : "s"} in this period have not been marked cleared against the statement.`);
  }
  if (!summary.glMatchesStatement) {
    notes.push(`VYRON's General Ledger balance differs from the statement closing balance by ${summary.difference.toFixed(2)}.`);
  }
  return notes;
}

/** Exported so callers can classify an item the same way the Explorer
 * does, without re-deriving the rule. */
export { transactionPostingStatus };
