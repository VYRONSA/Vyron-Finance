/**
 * Repository layer for Bank Reconciliation sessions. See
 * supabase/migrations/0022_cashbook_reconciliation.sql.
 * `ae_bank_transactions.reconciliation_id` (updated here) IS the
 * outstanding/cleared marker — no separate reconciliation-line table.
 */

import { createClient } from "@/lib/supabase/server";
import { bankReconciliationFromRow, type BankReconciliationRow } from "@/server/banking/mappers";
import { bankTransactionFromRow, type BankTransactionRow } from "@/server/accounting/mappers";
import type { BankReconciliation } from "@/server/banking/types";
import type { BankTransactionRecord } from "@/server/accounting/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

export type NewBankReconciliation = { bankAccountId: number; statementDate: string; statementClosingBalance: number; notes?: string; createdBy?: string };

export async function createReconciliation(companyId: string, input: NewBankReconciliation): Promise<BankReconciliation> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_reconciliations")
    .insert({
      company_id: companyId,
      bank_account_id: input.bankAccountId,
      statement_date: input.statementDate,
      statement_closing_balance: input.statementClosingBalance,
      notes: input.notes ?? "",
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<BankReconciliationRow>();
  if (error) throw error;
  return bankReconciliationFromRow(data);
}

export async function listReconciliations(companyId: string, bankAccountId?: number): Promise<BankReconciliation[]> {
  const supabase = await createClient();
  let query = supabase.from("bank_reconciliations").select("*").eq("company_id", companyId);
  if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
  const { data, error } = await query.order("statement_date", { ascending: false }).limit(LIST_CAP).returns<BankReconciliationRow[]>();
  if (error) throw error;
  return data.map(bankReconciliationFromRow);
}

export async function getReconciliation(companyId: string, reconciliationId: number): Promise<BankReconciliation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_reconciliations").select("*").eq("company_id", companyId).eq("id", reconciliationId).maybeSingle<BankReconciliationRow>();
  if (error) throw error;
  return data ? bankReconciliationFromRow(data) : null;
}

export async function updateReconciliation(companyId: string, reconciliationId: number, fields: Record<string, unknown>): Promise<BankReconciliation> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_reconciliations").update(fields).eq("company_id", companyId).eq("id", reconciliationId);
  if (error) throw error;
  const reconciliation = await getReconciliation(companyId, reconciliationId);
  if (!reconciliation) throw new Error(`No bank reconciliation with id ${reconciliationId}`);
  return reconciliation;
}

/** Marks transactions as cleared in this reconciliation session (real-time,
 * not only at "Complete" — matches how a real reconciliation workspace
 * lets a preparer tick items off one at a time before finishing). */
export async function clearTransactions(companyId: string, reconciliationId: number, transactionIds: number[]): Promise<void> {
  if (transactionIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("ae_bank_transactions").update({ reconciliation_id: reconciliationId }).eq("company_id", companyId).in("id", transactionIds);
  if (error) throw error;
}

/** Un-ticks specific transactions — used by manual override during an
 * in-progress or reopened session. */
export async function unclearTransactions(companyId: string, transactionIds: number[]): Promise<void> {
  if (transactionIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("ae_bank_transactions").update({ reconciliation_id: null }).eq("company_id", companyId).in("id", transactionIds);
  if (error) throw error;
}

export async function listReconciledTransactions(companyId: string, reconciliationId: number): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select("*")
    .eq("company_id", companyId)
    .eq("reconciliation_id", reconciliationId)
    .order("transaction_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

/** Every transaction for a bank account, needed by the reconciliation
 * engine to compute outstanding items (unreconciled, dated <= statement
 * date) — reuses the plain company+account scope Transaction Explorer
 * already queries, not a bespoke filter. */
export async function listTransactionsForAccount(companyId: string, bankAccountId: number): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_account_id", bankAccountId)
    .order("transaction_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}
