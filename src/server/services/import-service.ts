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
import { validateStatement, type StatementValidationResult } from "@/server/import-centre/pdf-statement-validation";
import { NULL_STATEMENT_METADATA, type BankStatementMetadata, type BankStatementParseResult, type ImportExceptionRecord, type ParsedBankTransaction } from "@/server/import-centre/types";
import * as importRepo from "@/server/repositories/import-repository";
import * as supplierRepo from "@/server/repositories/supplier-reconciliation-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { applyRulesToTransactions } from "@/server/services/rule-processing-service";
import type { ImportBatch } from "@/server/accounting/types";

export class ValidationError extends Error {}

export type ImportOutcome = {
  batch: ImportBatch;
  exceptions: ImportExceptionRecord[];
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

/** Shared commit step for bank-statement transactions — used both by the
 * direct-commit CSV/XLSX/OFX/QIF path (`importBankStatement`) and the
 * PDF review-then-commit path (`confirmPdfBankStatementImport`). Resolves
 * (or creates) each row's bank account, ingests idempotently, and
 * collects the ids of the rows genuinely newly created (as opposed to
 * already-on-file duplicates) so the caller can run the Banking Rules
 * engine against exactly those. */
async function commitBankTransactions(
  companyId: string,
  transactions: ParsedBankTransaction[],
  batchId: string,
  sourceFilename: string,
): Promise<{ importedCount: number; duplicateCount: number; createdTransactionIds: number[] }> {
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
  const createdTransactionIds: number[] = [];

  for (const txn of transactions) {
    const bankAccountId = await resolveBankAccountId(txn.bankAccount);
    // Never null for CSV/XLSX/OFX/QIF: those parsers only push a row once
    // its date parsed successfully (an unparseable date is an "Invalid
    // Date" exception, and the row is skipped rather than added). A PDF
    // review-screen correction could in principle leave this blank, so
    // still guarded here rather than assumed.
    const transactionDate = txn.transactionDate;
    if (!transactionDate) continue;
    const { transaction, created } = await importRepo.ingestBankTransactionIdempotent(companyId, {
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
      sourceFilename,
    });
    if (created) {
      importedCount++;
      createdTransactionIds.push(transaction.id);
    } else {
      duplicateCount++;
    }
  }

  return { importedCount, duplicateCount, createdTransactionIds };
}

/** Dispatches to the matching entry in `BANK_STATEMENT_ADAPTERS` (CSV,
 * Excel, OFX, QIF) via the extensible parser framework. PDF is
 * deliberately NOT handled here — see `previewPdfBankStatement`/
 * `confirmPdfBankStatementImport` below for why PDF needs a review step
 * these single-shot formats don't. */
export async function importBankStatement(companyId: string, file: File, importedBy = "System"): Promise<ImportOutcome> {
  if (file.name.toLowerCase().endsWith(".pdf")) {
    throw new ValidationError("PDF bank statements go through the review screen (preview, then confirm) — use previewPdfBankStatement instead.");
  }

  const buffer = await file.arrayBuffer();
  const batchId = generateBatchId();

  const adapter = resolveBankStatementAdapter(file.name);
  if (!adapter) {
    throw new ValidationError(`Unsupported file type for bank statement import. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }
  const parseResult: BankStatementParseResult = await adapter.parse(buffer, file.name, batchId);
  const { transactions, exceptions } = parseResult;

  const { importedCount, duplicateCount } = await commitBankTransactions(companyId, transactions, batchId, file.name);

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

  return { batch, exceptions };
}

export type PdfStatementPreview = {
  batchId: string;
  sourceFilename: string;
  pdfDetection: { bankId: string; bankName: string; confidence: number; status: "validated" | "implemented-unvalidated" | "awaiting-validation" };
  metadata: BankStatementMetadata;
  transactions: ParsedBankTransaction[];
  exceptions: ImportExceptionRecord[];
  validation: StatementValidationResult;
  /** The prior batch this looks like a re-upload of, if the detected
   * bank account + statement period already has one on file — null when
   * there's nothing to warn about, or when the statement's own account
   * number/period couldn't be determined yet (framework-only banks). */
  duplicateOfBatch: ImportBatch | null;
};

/** Step 1 of PDF Bank Statement Import's review flow — the Board's own
 * "Display all extracted transactions for user review before import"
 * requirement. Parses and validates a PDF statement WITHOUT writing
 * anything to `ae_bank_transactions`/`ae_import_batches`: purely a
 * read-only preview the Import Review Screen renders, lets the user
 * correct, and then either confirms (`confirmPdfBankStatementImport`)
 * or discards. Every named bank still returns zero transactions today
 * (see `bank-statement-adapter-registry.ts`) — this preview step is
 * fully wired and ready for the moment a real parser produces some. */
export async function previewPdfBankStatement(companyId: string, file: File): Promise<PdfStatementPreview> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new ValidationError("previewPdfBankStatement only accepts .pdf files.");
  }

  const buffer = await file.arrayBuffer();
  const batchId = generateBatchId();

  const text = await extractPdfText(buffer);
  const detection: PdfBankDetection | null = resolvePdfBankAdapter(text);
  if (!detection) {
    throw new ValidationError(
      "Could not identify which bank produced this PDF statement — none of the 10 supported banks' name/domain markers were found in its text. If this is a genuine statement from a supported bank, its letterhead wording may differ from what's currently recognised.",
    );
  }

  const parseResult = await detection.adapter.parse(buffer, file.name, batchId);
  const metadata = parseResult.metadata ?? NULL_STATEMENT_METADATA;
  const validation = validateStatement(metadata, parseResult.transactions);

  let duplicateOfBatch: ImportBatch | null = null;
  if (metadata.accountNumber && metadata.statementPeriodStart && metadata.statementPeriodEnd) {
    const bankAccount = await bankAccountRepo.findBankAccountByNumber(companyId, metadata.accountNumber);
    if (bankAccount) {
      duplicateOfBatch = await importRepo.findMatchingStatementBatch(companyId, bankAccount.id, metadata.statementPeriodStart, metadata.statementPeriodEnd);
    }
  }

  return {
    batchId,
    sourceFilename: file.name,
    pdfDetection: {
      bankId: detection.adapter.id,
      bankName: detection.adapter.label.replace(/ \(PDF\).*/, ""),
      confidence: detection.confidence,
      status: detection.adapter.status ?? "awaiting-validation",
    },
    metadata,
    transactions: parseResult.transactions,
    exceptions: parseResult.exceptions,
    validation,
    duplicateOfBatch,
  };
}

export type ConfirmPdfImportInput = {
  batchId: string;
  sourceFilename: string;
  metadata: BankStatementMetadata;
  /** The transactions from `previewPdfBankStatement`, after any manual
   * correction the user made in the Import Review Screen. */
  transactions: ParsedBankTransaction[];
};

export type ConfirmPdfImportOutcome = {
  batch: ImportBatch;
  importedCount: number;
  duplicateCount: number;
  /** How many of the newly imported transactions the Banking Rules
   * engine auto-allocated immediately — the Board's "Integrate fully
   * with the existing Banking Rules engine so rules can be applied
   * immediately after extraction" requirement. */
  rulesAutoAllocated: number;
};

/** Step 2 — commits the (possibly user-corrected) transactions from a
 * prior `previewPdfBankStatement` call, records the real statement
 * metadata and its balance-reconciliation result on the import batch,
 * then immediately runs the newly created transactions through the same
 * Banking Rules pipeline Phase 5/6's scan-and-apply and the "Apply Rule"
 * bulk action already use (`applyRulesToTransactions`) — no separate
 * rule-matching code path for PDF-sourced transactions. */
export async function confirmPdfBankStatementImport(companyId: string, input: ConfirmPdfImportInput, importedBy = "System"): Promise<ConfirmPdfImportOutcome> {
  const { metadata, transactions } = input;
  const validation = validateStatement(metadata, transactions);

  const { importedCount, duplicateCount, createdTransactionIds } = await commitBankTransactions(companyId, transactions, input.batchId, input.sourceFilename);

  let bankAccountId: number | null = null;
  if (metadata.accountNumber) {
    const account = await bankAccountRepo.getOrCreateBankAccountByNumber(companyId, metadata.accountNumber);
    bankAccountId = account.id;
  }

  const batch = await importRepo.insertImportBatch(companyId, {
    batchId: input.batchId,
    importType: "bank_transactions",
    sourceFilename: input.sourceFilename,
    rowCount: transactions.length,
    importedCount,
    duplicateCount,
    exceptionCount: 0,
    importedBy,
    statement: {
      bankAccountId,
      accountHolder: metadata.accountHolder,
      accountNumber: metadata.accountNumber,
      periodStart: metadata.statementPeriodStart,
      periodEnd: metadata.statementPeriodEnd,
      openingBalance: metadata.openingBalance,
      closingBalance: metadata.closingBalance,
      balanceReconciles: validation.balanceReconciliation.reconciles,
    },
  });

  await recordUsageEvent(companyId, "bank_imports");

  let rulesAutoAllocated = 0;
  if (createdTransactionIds.length > 0) {
    const results = await applyRulesToTransactions(companyId, createdTransactionIds, importedBy);
    rulesAutoAllocated = results.filter((r) => r.autoPosted).length;
  }

  return { batch, importedCount, duplicateCount, rulesAutoAllocated };
}

export async function listRecentImports(companyId: string): Promise<ImportBatch[]> {
  return importRepo.listRecentImportBatches(companyId);
}
