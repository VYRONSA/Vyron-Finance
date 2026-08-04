/**
 * Repository layer for the Cashbook — manual capture writes into the
 * SAME `ae_bank_transactions` table Import Centre already populates (One
 * Business Object), plus real CRUD for Cashbook Batches. Reuses
 * `transaction-explorer-repository.ts::getTransaction` for single-row
 * reads rather than a second lookup function.
 */

import { createClient } from "@/lib/supabase/server";
import { bankTransactionFromRow, type BankTransactionRow } from "@/server/accounting/mappers";
import { cashbookBatchFromRow, type CashbookBatchRow } from "@/server/banking/mappers";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { CashbookBatch, CashbookBatchType } from "@/server/banking/types";

export { getTransaction as getCashbookTransaction } from "@/server/repositories/transaction-explorer-repository";

export type NewManualTransaction = {
  bankAccountId: number;
  bankAccount: string;
  transactionDate: string;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  glAccount: string;
  vat: number;
  notes: string;
  cashbookBatchId: number | null;
};

export async function createManualTransaction(companyId: string, input: NewManualTransaction): Promise<BankTransactionRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .insert({
      company_id: companyId,
      bank_account_id: input.bankAccountId,
      bank_account: input.bankAccount,
      transaction_date: input.transactionDate,
      reference: input.reference,
      description: input.description,
      beneficiary: input.beneficiary,
      debit: input.debit,
      credit: input.credit,
      gl_account: input.glAccount,
      vat: input.vat,
      notes: input.notes,
      entry_source: "Manual",
      capture_status: "Draft",
      cashbook_batch_id: input.cashbookBatchId,
      allocation_status: "Unallocated",
    })
    .select("*")
    .single<BankTransactionRow>();
  if (error) throw error;
  return bankTransactionFromRow(data);
}

export type CashbookFilters = {
  entrySource?: "Imported" | "Manual";
  captureStatus?: string;
  direction?: "Receipts" | "Payments";
  dateFrom?: string;
  dateTo?: string;
};

export async function listCashbookTransactions(companyId: string, filters: CashbookFilters = {}): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  let query = supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId);
  if (filters.entrySource) query = query.eq("entry_source", filters.entrySource);
  if (filters.captureStatus) query = query.eq("capture_status", filters.captureStatus);
  if (filters.direction === "Receipts") query = query.gt("credit", 0);
  if (filters.direction === "Payments") query = query.gt("debit", 0);
  if (filters.dateFrom) query = query.gte("transaction_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("transaction_date", filters.dateTo);
  const { data, error } = await query.order("transaction_date", { ascending: false }).returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

export async function setCaptureStatus(companyId: string, transactionId: number, status: string, journalId?: number | null): Promise<BankTransactionRecord> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { capture_status: status };
  if (journalId !== undefined) update.journal_id = journalId;
  const { error } = await supabase.from("ae_bank_transactions").update(update).eq("company_id", companyId).eq("id", transactionId);
  if (error) throw error;
  const { data, error: getError } = await supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId).eq("id", transactionId).single<BankTransactionRow>();
  if (getError) throw getError;
  return bankTransactionFromRow(data);
}

export type NewCashbookBatch = { batchDate: string; batchType: CashbookBatchType; notes?: string; createdBy?: string };

export async function nextCashbookBatchNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("cashbook_batches").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `CB${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function createCashbookBatch(companyId: string, input: NewCashbookBatch): Promise<CashbookBatch> {
  const supabase = await createClient();
  const batchNumber = await nextCashbookBatchNumber(companyId);
  const { data, error } = await supabase
    .from("cashbook_batches")
    .insert({ company_id: companyId, batch_number: batchNumber, batch_date: input.batchDate, batch_type: input.batchType, notes: input.notes ?? "", created_by: input.createdBy ?? "System" })
    .select("*")
    .single<CashbookBatchRow>();
  if (error) throw error;
  return cashbookBatchFromRow(data);
}

export async function listCashbookBatches(companyId: string): Promise<CashbookBatch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cashbook_batches").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).returns<CashbookBatchRow[]>();
  if (error) throw error;
  return data.map(cashbookBatchFromRow);
}

export async function getCashbookBatch(companyId: string, batchId: number): Promise<CashbookBatch | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cashbook_batches").select("*").eq("company_id", companyId).eq("id", batchId).maybeSingle<CashbookBatchRow>();
  if (error) throw error;
  return data ? cashbookBatchFromRow(data) : null;
}

export async function setBatchStatus(companyId: string, batchId: number, status: string): Promise<CashbookBatch> {
  const supabase = await createClient();
  const { error } = await supabase.from("cashbook_batches").update({ status }).eq("company_id", companyId).eq("id", batchId);
  if (error) throw error;
  const batch = await getCashbookBatch(companyId, batchId);
  if (!batch) throw new Error(`No cashbook batch with id ${batchId}`);
  return batch;
}

export async function listBatchTransactions(companyId: string, batchId: number): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId).eq("cashbook_batch_id", batchId).returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}
