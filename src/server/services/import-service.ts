/**
 * Application Service layer for the Import Centre — orchestrates the pure
 * CSV parsers against the repository layer: resolves/creates suppliers and
 * bank accounts, ingests rows idempotently, and records one import batch
 * per uploaded file. Never talks to Supabase directly.
 */

import { parseBillsCsv } from "@/server/import-centre/xero-bills-parser";
import { decodeCsvBuffer } from "@/server/import-centre/csv-utils";
import { resolveBankStatementAdapter, resolvePdfBankAdapter, SUPPORTED_EXTENSIONS, type PdfBankDetection } from "@/server/import-centre/bank-statement-adapter-registry";
import { extractPdfText } from "@/server/import-centre/pdf-text-extraction";
import type { BankStatementParseResult, ImportExceptionRecord } from "@/server/import-centre/types";
import * as importRepo from "@/server/repositories/import-repository";
import * as supplierRepo from "@/server/repositories/supplier-reconciliation-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { ImportBatch } from "@/server/accounting/types";

export class ValidationError extends Error {}

export type ImportOutcome = {
  batch: ImportBatch;
  exceptions: ImportExceptionRecord[];
  /** Pilot Review Round 1, Phase 9 — populated only for a `.pdf` upload:
   * which of the 10 named banks was detected from the statement's own
   * text, and how confident that detection is. `null` means a PDF was
   * uploaded but no known bank's markers were found in it. */
  pdfDetection?: { bankId: string; bankName: string; confidence: number; status: "validated" | "awaiting-validation" } | null;
};

function generateBatchId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `BATCH-${stamp}`;
}

async function getOrCreateSupplierId(companyId: string, name: string, cache: Map<string, number>): Promise<number | null> {
  if (!name) return null;
  const cacheKey = name.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const existing = await supplierRepo.findSupplierByName(companyId, name);
  const supplier = existing ?? (await supplierRepo.createSupplierByName(companyId, name));
  cache.set(cacheKey, supplier.id);
  return supplier.id;
}

export async function importBillsCsv(companyId: string, file: File, importedBy = "System"): Promise<ImportOutcome> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new ValidationError("Only .csv files are supported for Bills / Credit Notes import.");
  }

  const buffer = await file.arrayBuffer();
  const text = decodeCsvBuffer(buffer);
  const batchId = generateBatchId();
  const { transactions, exceptions } = parseBillsCsv(text, file.name, batchId);

  const supplierCache = new Map<string, number>();
  let importedCount = 0;
  let duplicateCount = 0;

  for (const txn of transactions) {
    const supplierId = await getOrCreateSupplierId(companyId, txn.supplier, supplierCache);
    const { created } = await importRepo.ingestBillIdempotent(companyId, {
      supplierId,
      supplierName: txn.supplier,
      invoiceNumber: txn.invoiceNumber,
      documentType: txn.documentType,
      invoiceDate: txn.invoiceDate,
      dueDate: txn.dueDate,
      vat: txn.vat,
      total: txn.total,
      outstanding: txn.amountDue,
      importBatch: batchId,
      sourceFilename: file.name,
    });
    if (created) importedCount++;
    else duplicateCount++;
  }

  const batch = await importRepo.insertImportBatch(companyId, {
    batchId,
    importType: "bills",
    sourceFilename: file.name,
    rowCount: transactions.length + exceptions.filter((e) => e.exceptionType !== "VAT Mismatch").length,
    importedCount,
    duplicateCount,
    exceptionCount: exceptions.length,
    importedBy,
  });

  return { batch, exceptions };
}

/** Dispatches to the matching entry in `BANK_STATEMENT_ADAPTERS` (CSV,
 * Excel, OFX, QIF today) via the extensible parser framework — adding a
 * new bank-specific PDF adapter later needs no change here at all. */
export async function importBankStatement(companyId: string, file: File, importedBy = "System"): Promise<ImportOutcome> {
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const buffer = await file.arrayBuffer();
  const batchId = generateBatchId();

  let pdfDetection: ImportOutcome["pdfDetection"] = undefined;
  let parseResult: BankStatementParseResult;

  if (isPdf) {
    // Phase 9 — filename can't identify a bank for a PDF (unlike every
    // other format here, whose extension IS the match); real content
    // extraction + marker detection replaces `resolveBankStatementAdapter`
    // for this one format, see `bank-statement-adapter-registry.ts`.
    const text = await extractPdfText(buffer);
    const detection: PdfBankDetection | null = resolvePdfBankAdapter(text);
    if (!detection) {
      throw new ValidationError(
        "Could not identify which bank produced this PDF statement — none of the 10 supported banks' name/domain markers were found in its text. If this is a genuine statement from a supported bank, its letterhead wording may differ from what's currently recognised.",
      );
    }
    pdfDetection = { bankId: detection.adapter.id, bankName: detection.adapter.label.replace(" (PDF) — awaiting validation", ""), confidence: detection.confidence, status: detection.adapter.status ?? "awaiting-validation" };
    parseResult = await detection.adapter.parse(buffer, file.name, batchId);
  } else {
    const adapter = resolveBankStatementAdapter(file.name);
    if (!adapter) {
      throw new ValidationError(`Unsupported file type for bank statement import. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
    }
    parseResult = await adapter.parse(buffer, file.name, batchId);
  }

  const { transactions, exceptions } = parseResult;

  const bankAccountCache = new Map<string, number | null>();
  async function resolveBankAccountId(accountNumber: string): Promise<number | null> {
    if (!accountNumber) return null;
    const cached = bankAccountCache.get(accountNumber);
    if (cached !== undefined) return cached;
    const account = await bankAccountRepo.getOrCreateBankAccountByNumber(companyId, accountNumber);
    bankAccountCache.set(accountNumber, account.id);
    return account.id;
  }

  let importedCount = 0;
  let duplicateCount = 0;

  for (const txn of transactions) {
    const bankAccountId = await resolveBankAccountId(txn.bankAccount);
    // Never null here: parseBankStatementCsv only pushes a row once its
    // date parsed successfully (an unparseable date is an "Invalid Date"
    // exception, and the row is skipped rather than added).
    const transactionDate = txn.transactionDate;
    if (!transactionDate) continue;
    const { created } = await importRepo.ingestBankTransactionIdempotent(companyId, {
      transactionDate,
      reference: txn.reference,
      description: txn.description,
      beneficiary: txn.beneficiary,
      debit: txn.debit,
      credit: txn.credit,
      balance: txn.balance,
      bankAccount: txn.bankAccount,
      bankAccountId,
      vat: txn.vat,
      glAccount: txn.glAccount,
      notes: txn.notes,
      importBatch: batchId,
      sourceFilename: file.name,
    });
    if (created) importedCount++;
    else duplicateCount++;
  }

  const batch = await importRepo.insertImportBatch(companyId, {
    batchId,
    importType: "bank_transactions",
    sourceFilename: file.name,
    rowCount: transactions.length + exceptions.length,
    importedCount,
    duplicateCount,
    exceptionCount: exceptions.length,
    importedBy,
  });

  // Commercial Billing Platform — one Usage Engine event per completed
  // bank-statement import batch (not per row: "Bank Imports" is a plan
  // usage dimension, and a batch is the real unit of work a customer
  // performs, matching how the UI/history already counts imports).
  await recordUsageEvent(companyId, "bank_imports");

  return { batch, exceptions, pdfDetection };
}

export async function listRecentImports(companyId: string): Promise<ImportBatch[]> {
  return importRepo.listRecentImportBatches(companyId);
}
