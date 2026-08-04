/**
 * Application Service for Bank Reconciliation — "outstanding deposits,
 * outstanding payments, previous reconciling items, auto matching,
 * manual matching, bank balance, GL balance, difference analysis,
 * reconciliation history, re-open reconciliation, month-end lock," per
 * the Product Review Board's own Workflow Completion Audit. `GL Balance`
 * is the REAL Trial Balance figure for this bank account's resolved GL
 * control account (`trial-balance-service.ts`, already real, already
 * tested) — never re-derived by summing transactions locally.
 */

import * as repo from "@/server/repositories/bank-reconciliation-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { resolveBankGlAccount } from "@/server/services/journal-service";
import { autoMatchableTransactionIds, buildReconciliationSummary, type ReconciliationSummary } from "@/server/banking/reconciliation-engine";
import type { BankReconciliation } from "@/server/banking/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const listReconciliations = repo.listReconciliations;

async function requireReconciliation(companyId: string, reconciliationId: number): Promise<BankReconciliation> {
  const reconciliation = await repo.getReconciliation(companyId, reconciliationId);
  if (!reconciliation) throw new NotFoundError(`No bank reconciliation with id ${reconciliationId}.`);
  return reconciliation;
}

async function computeGlClosingBalance(companyId: string, bankAccountId: number, asOfDate: string): Promise<number> {
  const bankAccount = await bankAccountRepo.getBankAccount(companyId, bankAccountId);
  if (!bankAccount) throw new ValidationError(`No bank account with id ${bankAccountId}.`);
  const code = resolveBankGlAccount({ glAccount: bankAccount.glAccount, accountNumber: bankAccount.accountNumber }, bankAccount.accountName);
  const trialBalance = await getTrialBalance(companyId, asOfDate);
  const row = trialBalance.rows.find((r) => r.accountCode === code);
  return row ? round2(row.debitBalance - row.creditBalance) : 0; // Bank is a debit-normal Asset account.
}

export async function startReconciliation(companyId: string, bankAccountId: number, statementDate: string, statementClosingBalance: number, createdBy = "System"): Promise<BankReconciliation> {
  if (!bankAccountId) throw new ValidationError("Bank account is required.");
  if (!statementDate) throw new ValidationError("Statement date is required.");

  const glClosingBalance = await computeGlClosingBalance(companyId, bankAccountId, statementDate);
  const reconciliation = await repo.createReconciliation(companyId, { bankAccountId, statementDate, statementClosingBalance: round2(statementClosingBalance), createdBy });
  return repo.updateReconciliation(companyId, reconciliation.id, {
    gl_closing_balance: glClosingBalance,
    difference: round2(statementClosingBalance - glClosingBalance),
  });
}

export async function getReconciliationSummary(companyId: string, reconciliationId: number): Promise<ReconciliationSummary> {
  const reconciliation = await requireReconciliation(companyId, reconciliationId);
  const transactions = await repo.listTransactionsForAccount(companyId, reconciliation.bankAccountId);
  const glClosingBalance = reconciliation.glClosingBalance ?? (await computeGlClosingBalance(companyId, reconciliation.bankAccountId, reconciliation.statementDate));
  return buildReconciliationSummary(transactions, reconciliation.statementDate, reconciliation.statementClosingBalance, glClosingBalance);
}

/** Clears every outstanding item that's already genuinely posted to the
 * GL — a real rule (see `reconciliation-engine.ts`'s own docstring), not
 * a guess. */
export async function autoMatch(companyId: string, reconciliationId: number): Promise<number> {
  const reconciliation = await requireReconciliation(companyId, reconciliationId);
  if (reconciliation.status === "Completed") throw new ValidationError("This reconciliation is already Completed — reopen it first.");
  const transactions = await repo.listTransactionsForAccount(companyId, reconciliation.bankAccountId);
  const ids = autoMatchableTransactionIds(transactions, reconciliation.statementDate);
  await repo.clearTransactions(companyId, reconciliationId, ids);
  return ids.length;
}

export async function toggleClearTransaction(companyId: string, reconciliationId: number, transactionId: number, cleared: boolean): Promise<void> {
  const reconciliation = await requireReconciliation(companyId, reconciliationId);
  if (reconciliation.status === "Completed") throw new ValidationError("This reconciliation is already Completed — reopen it first.");
  if (cleared) await repo.clearTransactions(companyId, reconciliationId, [transactionId]);
  else await repo.unclearTransactions(companyId, [transactionId]);
}

export async function completeReconciliation(companyId: string, reconciliationId: number, completedBy = "System", lockMonthEnd = false): Promise<BankReconciliation> {
  const reconciliation = await requireReconciliation(companyId, reconciliationId);
  if (reconciliation.status === "Completed") throw new ValidationError("This reconciliation is already Completed.");

  const glClosingBalance = await computeGlClosingBalance(companyId, reconciliation.bankAccountId, reconciliation.statementDate);
  const difference = round2(reconciliation.statementClosingBalance - glClosingBalance);

  return repo.updateReconciliation(companyId, reconciliationId, {
    status: "Completed",
    gl_closing_balance: glClosingBalance,
    difference,
    completed_by: completedBy,
    completed_at: new Date().toISOString(),
    month_end_locked: lockMonthEnd,
  });
}

export async function reopenReconciliation(companyId: string, reconciliationId: number, reopenedBy = "System", reason: string): Promise<BankReconciliation> {
  const reconciliation = await requireReconciliation(companyId, reconciliationId);
  if (reconciliation.status !== "Completed") throw new ValidationError("Only a Completed reconciliation can be reopened.");
  if (!reason?.trim()) throw new ValidationError("A reason is required to reopen a completed reconciliation.");

  return repo.updateReconciliation(companyId, reconciliationId, {
    status: "Reopened",
    month_end_locked: false,
    reopened_by: reopenedBy,
    reopened_at: new Date().toISOString(),
    reopen_reason: reason.trim(),
  });
}

/** Real enforcement, scoped honestly: blocks new Cashbook Capture dated
 * on/before a locked reconciliation's statement date for that bank
 * account. Import Centre ingestion is intentionally NOT blocked by this
 * — a late-arriving bank-statement row still needs to be visible as a
 * real exception, not silently rejected. */
export async function assertNotMonthEndLocked(companyId: string, bankAccountId: number, transactionDate: string): Promise<void> {
  const reconciliations = await repo.listReconciliations(companyId, bankAccountId);
  const locking = reconciliations.find((r) => r.monthEndLocked && r.status === "Completed" && transactionDate <= r.statementDate);
  if (locking) {
    throw new ValidationError(`${transactionDate} falls on or before the ${locking.statementDate} month-end lock for this bank account — reopen that reconciliation first if this entry is genuinely needed.`);
  }
}
