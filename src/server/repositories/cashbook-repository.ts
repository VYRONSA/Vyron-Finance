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
import { nextSourceOccurrence } from "@/server/repositories/import-repository";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { CashbookBatch, CashbookBatchType } from "@/server/banking/types";

export { getTransaction as getCashbookTransaction } from "@/server/repositories/transaction-explorer-repository";

// RC-6 (Master Implementation Tracker) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
export const LIST_CAP = 10_000;

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
  /** Phase 39 — Transaction Explorer's own "+ Add Transaction" needs to
   * capture a running balance the way an imported statement row already
   * carries one (`ae_bank_transactions.balance` — an existing column, no
   * migration needed); every Cashbook caller leaves this unset (`null`,
   * same as before this field existed) since a Cashbook receipt/payment/
   * transfer has never captured a balance. */
  balance?: number | null;
};

/** Migration 0092 — a manually captured entry is never a duplicate of
 * anything: if the accountant deliberately captures the same amount to
 * the same payee on the same day twice, that is two entries and both must
 * save. `nextSourceOccurrence` hands out an ordinal that is free, so the
 * natural-key constraint (which exists to make re-importing a FILE
 * idempotent, not to police hand capture) can never reject one. The retry
 * covers two captures racing to the same ordinal. */
const MAX_OCCURRENCE_ATTEMPTS = 5;
const UNIQUE_VIOLATION = "23505";

export async function createManualTransaction(companyId: string, input: NewManualTransaction): Promise<BankTransactionRecord> {
  for (let attempt = 0; attempt < MAX_OCCURRENCE_ATTEMPTS; attempt++) {
    const sourceOccurrence = await nextSourceOccurrence(companyId, {
      bankAccount: input.bankAccount,
      transactionDate: input.transactionDate,
      reference: input.reference,
      description: input.description,
      debit: input.debit,
      credit: input.credit,
    });
    const result = await insertManualTransaction(companyId, input, sourceOccurrence);
    if (result.ok) return result.transaction;
    if (result.error.code !== UNIQUE_VIOLATION || attempt === MAX_OCCURRENCE_ATTEMPTS - 1) throw result.error;
  }
  throw new Error("Could not allocate a source occurrence for this manual transaction.");
}

type InsertManualResult = { ok: true; transaction: BankTransactionRecord } | { ok: false; error: { code?: string } & Error };

async function insertManualTransaction(companyId: string, input: NewManualTransaction, sourceOccurrence: number): Promise<InsertManualResult> {
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
      // Phase 31C — this insert is the ONLY other write path into
      // `ae_bank_transactions` (manual Cashbook capture, not an import),
      // so it must also set the immutable dedup snapshot introduced by
      // migration 0089 — see `import-repository.ts::ingestBankTransactionIdempotent`'s
      // own doc comment for why this column exists and must never be
      // written anywhere else after creation.
      import_description: input.description,
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
      balance: input.balance ?? null,
      source_occurrence: sourceOccurrence,
    })
    .select("*")
    .single<BankTransactionRow>();
  if (error) return { ok: false, error: error as unknown as { code?: string } & Error };
  return { ok: true, transaction: bankTransactionFromRow(data) };
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
  const { data, error } = await query.order("transaction_date", { ascending: false }).limit(LIST_CAP).returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

export type ManualTransactionEdit = {
  transactionDate: string;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  glAccount: string;
  vat: number;
};

/** Finding #080 — the only way to correct a Draft/Submitted manually
 * captured entry used to be Cancel-and-recapture; this is the direct
 * update path, gated by capture status in the service layer above this. */
export async function updateManualTransaction(companyId: string, transactionId: number, edit: ManualTransactionEdit): Promise<BankTransactionRecord> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ae_bank_transactions")
    .update({
      transaction_date: edit.transactionDate,
      reference: edit.reference,
      description: edit.description,
      beneficiary: edit.beneficiary,
      debit: edit.debit,
      credit: edit.credit,
      gl_account: edit.glAccount,
      vat: edit.vat,
    })
    .eq("company_id", companyId)
    .eq("id", transactionId);
  if (error) throw error;
  const { data, error: getError } = await supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId).eq("id", transactionId).single<BankTransactionRow>();
  if (getError) throw getError;
  return bankTransactionFromRow(data);
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

/** Phase 29C — forensic audit finding: `approveAndPostCashbookEntry`/
 * `approveAndPostTransfer` (`cashbook-service.ts`) only ever guarded
 * double-posting with an app-level "read captureStatus, then write"
 * check, with a real window between the two — a genuine journal-posting
 * flow (`buildJournalFromEvent`/`createJournal`/`postApprovedJournals`)
 * runs in between. Two concurrent "Approve and Post" requests on the
 * SAME entry could both pass the initial check, both create a real
 * journal, and both call the old unguarded `setCaptureStatus` —
 * resulting in two posted journals for one Cashbook entry, with
 * `journal_id` left pointing at whichever call happened to write last.
 * This is the ONE atomically-guarded write specifically for "attach the
 * journal this entry was just posted with" — mirrors
 * `journal-repository.ts::linkTransactionToJournal`'s established
 * `.is("journal_id", null)` pattern exactly, so a losing concurrent
 * call gets `null` back (no silent double-post) instead of a second
 * "successful" write. The plain `setCaptureStatus` above remains
 * unchanged and is still used for every OTHER transition
 * (Submitted/Cancelled) which never creates a journal and so carries no
 * equivalent race risk. */
export async function postCaptureStatus(companyId: string, transactionId: number, journalId: number): Promise<BankTransactionRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .update({ capture_status: "Posted", journal_id: journalId })
    .eq("company_id", companyId)
    .eq("id", transactionId)
    .is("journal_id", null)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const { data: row, error: getError } = await supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId).eq("id", transactionId).single<BankTransactionRow>();
  if (getError) throw getError;
  return bankTransactionFromRow(row);
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
