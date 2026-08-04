/**
 * Repository layer for Bank Accounts — the only layer allowed to speak
 * Supabase, per the mandatory API separation (Browser -> API Route ->
 * Service -> Repository -> Supabase). Row Level Security (see
 * supabase/migrations/0003_bank_accounts.sql) enforces company isolation;
 * every query here still filters by company_id explicitly.
 */

import { createClient } from "@/lib/supabase/server";
import { bankAccountFromRow, type BankAccountRow, type BankAccountUpdatableFields } from "@/server/accounting/mappers";
import type { BankAccount } from "@/server/accounting/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

export async function listBankAccounts(companyId: string): Promise<BankAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_accounts")
    .select("*")
    .eq("company_id", companyId)
    .order("account_name")
    .returns<BankAccountRow[]>();
  if (error) throw error;
  return data.map(bankAccountFromRow);
}

export async function getBankAccount(companyId: string, accountId: number): Promise<BankAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_accounts")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", accountId)
    .maybeSingle<BankAccountRow>();
  if (error) throw error;
  return data ? bankAccountFromRow(data) : null;
}

export async function findBankAccountByNumber(companyId: string, accountNumber: string): Promise<BankAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_accounts")
    .select("*")
    .eq("company_id", companyId)
    .eq("account_number", accountNumber)
    .maybeSingle<BankAccountRow>();
  if (error) throw error;
  return data ? bankAccountFromRow(data) : null;
}

export type CreateBankAccountInput = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  accountType: string;
  branch: string;
  currency: string;
  openingBalance: number;
};

export async function createBankAccount(companyId: string, input: CreateBankAccountInput): Promise<BankAccount> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_accounts")
    .insert({
      company_id: companyId,
      account_number: input.accountNumber,
      account_name: input.accountName,
      bank_name: input.bankName,
      account_type: input.accountType,
      branch: input.branch,
      currency: input.currency,
      opening_balance: input.openingBalance,
      current_balance: input.openingBalance,
    })
    .select("*")
    .single<BankAccountRow>();
  if (error) throw error;
  return bankAccountFromRow(data);
}

export async function updateBankAccount(
  companyId: string,
  accountId: number,
  fields: BankAccountUpdatableFields,
): Promise<BankAccount> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_accounts")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", accountId)
    .select("*")
    .single<BankAccountRow>();
  if (error) throw error;
  return bankAccountFromRow(data);
}

/**
 * Ported from `BankAccountService.get_or_create` — resolves a bank
 * statement's raw account-number cell to a bank account row, auto-creating
 * one (named after the account number itself, since imports carry no
 * friendly name) the first time a given number is seen. Alias-table
 * resolution (`resolve_account_id`'s "Link To Existing Account" override,
 * Multi-Bank Management v1.1) has no equivalent table in this port yet —
 * every distinct account number gets its own bank account record.
 */
export async function getOrCreateBankAccountByNumber(companyId: string, accountNumber: string): Promise<BankAccount> {
  const existing = await findBankAccountByNumber(companyId, accountNumber);
  if (existing) return existing;
  return createBankAccount(companyId, {
    accountNumber,
    accountName: accountNumber,
    bankName: "",
    accountType: "",
    branch: "",
    currency: "ZAR",
    openingBalance: 0,
  });
}

export type BankAccountTransactionStats = {
  transactionCount: number;
  totalDebits: number;
  totalCredits: number;
  lastImport: string | null;
  matched: number;
  suggested: number;
  unallocated: number;
};

/**
 * Ported from `bank_account_service.get_summary_for_company`'s
 * aggregation query — a read-only aggregate over `ae_bank_transactions`,
 * no new business logic. Returns zeroed figures for an account with no
 * transactions rather than throwing, matching the reference's LEFT JOIN
 * behaviour.
 */
export async function getBankAccountStats(companyId: string, accountId: number): Promise<BankAccountTransactionStats> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select("debit, credit, transaction_date, allocation_status")
    .eq("company_id", companyId)
    .eq("bank_account_id", accountId)
    .order("transaction_date", { ascending: false })
    .limit(LIST_CAP);
  if (error) throw error;

  const rows = data ?? [];
  let totalDebits = 0;
  let totalCredits = 0;
  let lastImport: string | null = null;
  let matched = 0;
  let suggested = 0;
  let unallocated = 0;

  for (const row of rows) {
    totalDebits += Number(row.debit);
    totalCredits += Number(row.credit);
    if (row.transaction_date && (!lastImport || row.transaction_date > lastImport)) {
      lastImport = row.transaction_date;
    }
    if (row.allocation_status === "Matched" || row.allocation_status === "Allocated") matched += 1;
    else if (row.allocation_status === "Suggested") suggested += 1;
    else unallocated += 1;
  }

  return {
    transactionCount: rows.length,
    totalDebits: Math.round(totalDebits * 100) / 100,
    totalCredits: Math.round(totalCredits * 100) / 100,
    lastImport,
    matched,
    suggested,
    unallocated,
  };
}

export type RecentTransactionRow = {
  id: number;
  transactionDate: string | null;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  allocationStatus: string;
};

export async function listRecentTransactionsForAccount(
  companyId: string,
  accountId: number,
  limit = 10,
): Promise<RecentTransactionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select("id, transaction_date, description, beneficiary, debit, credit, allocation_status")
    .eq("company_id", companyId)
    .eq("bank_account_id", accountId)
    .order("transaction_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    transactionDate: row.transaction_date,
    description: row.description,
    beneficiary: row.beneficiary,
    debit: Number(row.debit),
    credit: Number(row.credit),
    allocationStatus: row.allocation_status,
  }));
}
