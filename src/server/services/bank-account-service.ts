/**
 * Application Service layer for Bank Accounts — validation and
 * orchestration on top of the repository, never talking to Supabase
 * directly (see ARCHITECTURE.md's API layer section).
 */

import * as repo from "@/server/repositories/bank-account-repository";
import { recordPermissionAuditEntry } from "@/server/repositories/permission-repository";
import { getOpeningBalanceGovernance } from "@/server/services/opening-balance-service";
import type { BankAccount, BankAccountSummary } from "@/server/accounting/types";

export class ValidationError extends Error {}

export type CreateBankAccountRequest = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  accountType?: string;
  branch?: string;
  currency?: string;
  openingBalance?: number;
};

/** Pure validation, exported for direct unit testing — no Supabase call
 * involved, so this is testable without a live project. */
export function validateCreateBankAccountInput(input: CreateBankAccountRequest) {
  if (!input.accountNumber?.trim()) throw new ValidationError("Account number is required.");
  if (!input.accountName?.trim()) throw new ValidationError("Account name is required.");
  if (!input.bankName?.trim()) throw new ValidationError("Bank name is required.");
}

export async function createBankAccount(companyId: string, input: CreateBankAccountRequest): Promise<BankAccount> {
  validateCreateBankAccountInput(input);

  const existing = await repo.findBankAccountByNumber(companyId, input.accountNumber.trim());
  if (existing) {
    throw new ValidationError(`An account with number ${input.accountNumber} already exists (${existing.accountName}).`);
  }

  return repo.createBankAccount(companyId, {
    accountNumber: input.accountNumber.trim(),
    accountName: input.accountName.trim(),
    bankName: input.bankName.trim(),
    accountType: input.accountType?.trim() ?? "",
    branch: input.branch?.trim() ?? "",
    currency: input.currency?.trim() || "ZAR",
    openingBalance: input.openingBalance ?? 0,
  });
}

export type EditBankAccountRequest = Partial<{
  accountName: string;
  bankName: string;
  accountType: string;
  branch: string;
  currency: string;
  notes: string;
  glAccount: string;
  // Pilot Review Round 1, Phase 2 — previously create-only.
  openingBalance: number;
  openingBalanceDate: string | null;
  openingBalanceReference: string;
  reason: string;
}>;

/** Pure core of the opening-balance edit path — changing the opening
 * balance shifts `current_balance` by the same delta, never recalculated
 * from scratch, so every real transaction/reconciliation movement
 * already posted against the account is preserved. Extracted for direct
 * unit testing, matching this codebase's pure-core/orchestration split. */
export function computeOpeningBalanceDelta(existingOpeningBalance: number, existingCurrentBalance: number, newOpeningBalance: number): { opening_balance: number; current_balance: number } {
  const delta = newOpeningBalance - existingOpeningBalance;
  return { opening_balance: newOpeningBalance, current_balance: existingCurrentBalance + delta };
}

export async function editBankAccount(companyId: string, accountId: number, input: EditBankAccountRequest, performedBy = "System"): Promise<BankAccount> {
  if (input.accountName !== undefined && !input.accountName.trim()) {
    throw new ValidationError("Account name cannot be empty.");
  }
  if (input.openingBalance !== undefined && (typeof input.openingBalance !== "number" || Number.isNaN(input.openingBalance))) {
    throw new ValidationError("Opening balance must be a number.");
  }

  const existing = input.openingBalance !== undefined ? await repo.getBankAccount(companyId, accountId) : null;
  if (input.openingBalance !== undefined && !existing) {
    throw new ValidationError(`No bank account with id ${accountId}.`);
  }

  if (input.openingBalance !== undefined && existing) {
    const governance = await getOpeningBalanceGovernance(companyId);
    if (governance.reasonRequired && !input.reason?.trim()) {
      throw new ValidationError("A reason is required to change an opening balance after go-live.");
    }
  }

  const updated = await repo.updateBankAccount(companyId, accountId, {
    ...(input.accountName !== undefined && { account_name: input.accountName.trim() }),
    ...(input.bankName !== undefined && { bank_name: input.bankName.trim() }),
    ...(input.accountType !== undefined && { account_type: input.accountType.trim() }),
    ...(input.branch !== undefined && { branch: input.branch.trim() }),
    ...(input.currency !== undefined && { currency: input.currency.trim() }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.glAccount !== undefined && { gl_account: input.glAccount.trim() }),
    ...(input.openingBalance !== undefined && existing && computeOpeningBalanceDelta(existing.openingBalance, existing.currentBalance, input.openingBalance)),
    ...(input.openingBalanceDate !== undefined && { opening_balance_date: input.openingBalanceDate }),
    ...(input.openingBalanceReference !== undefined && { opening_balance_reference: input.openingBalanceReference.trim() }),
  });

  if (input.openingBalance !== undefined && existing && input.openingBalance !== existing.openingBalance) {
    await recordPermissionAuditEntry(
      companyId, "BankAccountOpeningBalance", String(accountId), "openingBalance",
      existing.openingBalance.toFixed(2), input.openingBalance.toFixed(2),
      input.reason?.trim() || "Corrected during implementation.", performedBy,
    );
  }

  return updated;
}

export async function archiveBankAccount(companyId: string, accountId: number): Promise<BankAccount> {
  return repo.updateBankAccount(companyId, accountId, { status: "Archived" });
}

export async function reactivateBankAccount(companyId: string, accountId: number): Promise<BankAccount> {
  return repo.updateBankAccount(companyId, accountId, { status: "Active" });
}

export async function listBankAccountSummaries(companyId: string): Promise<BankAccountSummary[]> {
  const accounts = await repo.listBankAccounts(companyId);
  return Promise.all(
    accounts.map(async (account) => {
      const stats = await repo.getBankAccountStats(companyId, account.id);
      return {
        account,
        // `ae_bank_transactions` has no statement_number column yet (out
        // of Module 1's scope — it belongs to the Imports module's parser
        // metadata). Real once Module 3 adds it; 0 until then rather than
        // querying a column that doesn't exist.
        statementCount: 0,
        transactionCount: stats.transactionCount,
        totalDebits: stats.totalDebits,
        totalCredits: stats.totalCredits,
        lastImport: stats.lastImport,
        matched: stats.matched,
        suggested: stats.suggested,
        unallocated: stats.unallocated,
      };
    }),
  );
}

export async function getBankAccountSummary(companyId: string, accountId: number): Promise<BankAccountSummary | null> {
  const account = await repo.getBankAccount(companyId, accountId);
  if (!account) return null;
  const stats = await repo.getBankAccountStats(companyId, accountId);
  return {
    account,
    statementCount: 0,
    transactionCount: stats.transactionCount,
    totalDebits: stats.totalDebits,
    totalCredits: stats.totalCredits,
    lastImport: stats.lastImport,
    matched: stats.matched,
    suggested: stats.suggested,
    unallocated: stats.unallocated,
  };
}

export { listRecentTransactionsForAccount } from "@/server/repositories/bank-account-repository";

/** Masks all but the last 4 digits of an account number for display —
 * e.g. "62050837304" -> "•••• 7304". Never used for the value stored or
 * submitted back to the server, only for rendering. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.trim();
  if (digits.length <= 4) return digits;
  return `•••• ${digits.slice(-4)}`;
}
