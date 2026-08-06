/**
 * Repository layer for the Import Centre — the only layer allowed to
 * speak Supabase for import batches and idempotent bill/transaction
 * ingestion (see supabase/migrations/0004_import_centre.sql). Idempotency
 * mirrors the reference's SQLite `INSERT OR IGNORE` + fallback `SELECT`:
 * insert, and on a natural-key unique-constraint violation (Postgres error
 * 23505) select the row that's already on file instead of duplicating it.
 */

import { createClient } from "@/lib/supabase/server";
import { bankTransactionFromRow, billFromRow, importBatchFromRow, type BankTransactionRow, type ImportedBillRow, type ImportBatchRow } from "@/server/accounting/mappers";
import type { BankTransactionRecord, ImportBatch, ImportedBill } from "@/server/accounting/types";

const UNIQUE_VIOLATION = "23505";

export type NewImportBatch = {
  batchId: string;
  importType: "bills" | "bank_transactions";
  sourceFilename: string;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  exceptionCount: number;
  importedBy?: string;
  /** PDF Bank Statement Import only — see `ae_import_batches`'s own
   * migration comment (0058) for why this is nullable/optional. */
  statement?: {
    bankAccountId: number | null;
    accountHolder: string | null;
    accountNumber: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    openingBalance: number | null;
    closingBalance: number | null;
    balanceReconciles: boolean | null;
    /** Final Certification round — see migration 0061. */
    statementNumber?: string | null;
    creditLimit?: number | null;
    availableBalance?: number | null;
    interestSummary?: string | null;
    vat?: number | null;
    fees?: number | null;
  };
};

export async function insertImportBatch(companyId: string, batch: NewImportBatch): Promise<ImportBatch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_import_batches")
    .insert({
      company_id: companyId,
      batch_id: batch.batchId,
      import_type: batch.importType,
      source_filename: batch.sourceFilename,
      row_count: batch.rowCount,
      imported_count: batch.importedCount,
      duplicate_count: batch.duplicateCount,
      exception_count: batch.exceptionCount,
      imported_by: batch.importedBy ?? "System",
      bank_account_id: batch.statement?.bankAccountId ?? null,
      statement_account_holder: batch.statement?.accountHolder ?? null,
      statement_account_number: batch.statement?.accountNumber ?? null,
      statement_period_start: batch.statement?.periodStart ?? null,
      statement_period_end: batch.statement?.periodEnd ?? null,
      statement_opening_balance: batch.statement?.openingBalance ?? null,
      statement_closing_balance: batch.statement?.closingBalance ?? null,
      balance_reconciles: batch.statement?.balanceReconciles ?? null,
      statement_number: batch.statement?.statementNumber ?? null,
      statement_credit_limit: batch.statement?.creditLimit ?? null,
      statement_available_balance: batch.statement?.availableBalance ?? null,
      statement_interest_summary: batch.statement?.interestSummary ?? null,
      statement_vat: batch.statement?.vat ?? null,
      statement_fees: batch.statement?.fees ?? null,
    })
    .select("*")
    .single<ImportBatchRow>();
  if (error) throw error;
  return importBatchFromRow(data);
}

/** Duplicate-statement check for PDF Bank Statement Import — "has this
 * exact statement (same bank account, same period) already been
 * imported?" — surfaced to the user as a warning *before* they commit a
 * re-upload, rather than relying solely on the existing per-transaction
 * natural-key constraint (0004_import_centre.sql) catching it one row
 * at a time after the fact. */
export async function findMatchingStatementBatch(
  companyId: string,
  bankAccountId: number,
  periodStart: string,
  periodEnd: string,
): Promise<ImportBatch | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_import_batches")
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_account_id", bankAccountId)
    .eq("statement_period_start", periodStart)
    .eq("statement_period_end", periodEnd)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<ImportBatchRow[]>();
  if (error) throw error;
  return data.length > 0 ? importBatchFromRow(data[0]) : null;
}

/** Deletes every transaction imported under one batch plus the batch
 * record itself — Transaction Explorer's "Delete Import" bulk action.
 * Deliberately keyed by `import_batch`, not by an arbitrary row
 * selection: deleting a partial subset of a batch would leave its
 * recorded counts (imported/duplicate/exception) meaningless. */
export async function deleteImportBatch(companyId: string, importType: "bills" | "bank_transactions", importBatch: string): Promise<number> {
  const supabase = await createClient();
  const table = importType === "bills" ? "ae_imported_bills" : "ae_bank_transactions";

  const { error: deleteRowsError, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .eq("company_id", companyId)
    .eq("import_batch", importBatch);
  if (deleteRowsError) throw deleteRowsError;

  const { error: deleteBatchError } = await supabase
    .from("ae_import_batches")
    .delete()
    .eq("company_id", companyId)
    .eq("import_type", importType)
    .eq("batch_id", importBatch);
  if (deleteBatchError) throw deleteBatchError;

  return count ?? 0;
}

export async function listRecentImportBatches(companyId: string, limit = 20): Promise<ImportBatch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_import_batches")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ImportBatchRow[]>();
  if (error) throw error;
  return data.map(importBatchFromRow);
}

export type NewImportedBill = {
  supplierId: number | null;
  supplierName: string;
  invoiceNumber: string;
  documentType: "Bill" | "Credit Note";
  invoiceDate: string | null;
  dueDate: string | null;
  vat: number;
  total: number;
  outstanding: number;
  importBatch: string;
  sourceFilename: string;
};

export async function ingestBillIdempotent(companyId: string, bill: NewImportedBill): Promise<{ bill: ImportedBill; created: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .insert({
      company_id: companyId,
      supplier_id: bill.supplierId,
      supplier_name: bill.supplierName,
      invoice_number: bill.invoiceNumber,
      document_type: bill.documentType,
      invoice_date: bill.invoiceDate,
      due_date: bill.dueDate,
      vat: bill.vat,
      total: bill.total,
      outstanding: bill.outstanding,
      import_batch: bill.importBatch,
      source_filename: bill.sourceFilename,
    })
    .select("*")
    .single<ImportedBillRow>();

  if (!error) return { bill: billFromRow(data), created: true };
  if (error.code !== UNIQUE_VIOLATION) throw error;

  const { data: existing, error: selectError } = await supabase
    .from("ae_imported_bills")
    .select("*")
    .eq("company_id", companyId)
    .eq("supplier_name", bill.supplierName)
    .eq("invoice_number", bill.invoiceNumber)
    .single<ImportedBillRow>();
  if (selectError) throw selectError;
  return { bill: billFromRow(existing), created: false };
}

export type NewBankTransaction = {
  transactionDate: string;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  balance: number | null;
  bankAccount: string;
  bankAccountId: number | null;
  vat: number | null;
  glAccount: string;
  notes: string;
  importBatch: string;
  sourceFilename: string;
};

export async function ingestBankTransactionIdempotent(
  companyId: string,
  txn: NewBankTransaction,
): Promise<{ transaction: BankTransactionRecord; created: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .insert({
      company_id: companyId,
      transaction_date: txn.transactionDate,
      reference: txn.reference,
      description: txn.description,
      beneficiary: txn.beneficiary,
      debit: txn.debit,
      credit: txn.credit,
      balance: txn.balance,
      bank_account: txn.bankAccount,
      bank_account_id: txn.bankAccountId,
      vat: txn.vat,
      gl_account: txn.glAccount,
      notes: txn.notes,
      import_batch: txn.importBatch,
      source_filename: txn.sourceFilename,
    })
    .select("*")
    .single<BankTransactionRow>();

  if (!error) return { transaction: bankTransactionFromRow(data), created: true };
  if (error.code !== UNIQUE_VIOLATION) throw error;

  const { data: existing, error: selectError } = await supabase
    .from("ae_bank_transactions")
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_account", txn.bankAccount)
    .eq("transaction_date", txn.transactionDate)
    .eq("reference", txn.reference)
    .eq("debit", txn.debit)
    .eq("credit", txn.credit)
    .eq("description", txn.description)
    .single<BankTransactionRow>();
  if (selectError) throw selectError;
  return { transaction: bankTransactionFromRow(existing), created: false };
}
