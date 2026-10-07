/**
 * SD-3C — supplier statements: the workflow.
 *
 *   upload (request)   → original retained, statement Queued, response sent
 *   process (after the response, never inside the upload request)
 *                      → Processing → NeedsReview | ManualEntry | Failed
 *   review (reviewer)  → corrections, manual entry, supplier CONFIRMATION
 *                      → Ready (validated, supplier confirmed, base currency)
 *
 * Every decision is made by a pure module in `@/server/supplier-statements/`
 * (reading, validation, supplier proposal). This file calls them in order
 * and persists the result. Invariants, each covered by a test:
 *   1. NO ACCOUNTING. Nothing here reads or writes a journal, bill, payment,
 *      allocation or supplier balance. Reconciliation is SD-3D.
 *   2. NO GUESSING. Unreadable values stay unresolved; a supplier is only
 *      ever PROPOSED here and must be confirmed by a reviewer; the debit/
 *      credit convention is never flipped automatically.
 *   3. NO AI. Scanned statements go to manual entry (SD-3C has no OCR and
 *      live AI is off). The reader is provider-agnostic for later.
 *   4. The actor always comes from the session — never a request body.
 *   5. Audit details carry field names and ids, never statement content.
 */
import * as repo from "@/server/repositories/supplier-statement-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { readSupplierOriginalBytes } from "@/server/repositories/supplier-document-access-repository";
import { setSupplierOurAccountNumber } from "@/server/services/supplier-management-service";
import { parseStatementDate } from "@/server/supplier-statements/amounts";
import { detectStatementFileType, type StatementFileKind } from "@/server/supplier-statements/file-type";
import { readStatementFile } from "@/server/supplier-statements/read-statement";
import { proposeStatementSupplier } from "@/server/supplier-statements/supplier-match";
import { validateStatement } from "@/server/supplier-statements/validation";
import type { PrintedAgeing, SignConvention, StatementExtraction, StatementStatus, StatementTransactionType } from "@/server/supplier-statements/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

/** A statement whose processing stopped part-way may be requeued after this. */
const STALE_PROCESSING_MS = 10 * 60 * 1000;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// Upload → queue (inside the request: cheap, no reading of the file)
// ---------------------------------------------------------------------

export type RegisteredStatement = { statementId: number; status: StatementStatus; duplicateOfStatementId: number | null; message: string | null };

export async function registerUploadedStatement(
  companyId: string,
  documentId: number,
  contentSha256: string,
  kind: StatementFileKind,
): Promise<RegisteredStatement> {
  const performedBy = await getPerformedByLabel();
  const statement = await repo.insertStatement({ companyId, documentId, contentSha256, sourceType: kind });
  await repo.recordStatementEvent(companyId, statement.id, "Uploaded", { documentId, sourceType: kind });

  // The same bytes as a statement still in use: a copy, not a new statement.
  // A rejected copy does not block a legitimate re-upload (SD-1/SD-2 rule).
  const same = await repo.findStatementsWithSameFile(companyId, contentSha256, statement.id);
  const live = same.find((s) => s.status !== "Rejected" && s.status !== "Duplicate");
  if (live) {
    await repo.updateStatementAsSystem(companyId, statement.id, {
      status: "Duplicate",
      duplicate_of_statement_id: live.id,
      status_reason: `This is the same file as statement #${live.id}. Open that statement instead.`,
    });
    await repo.recordSystemStatementEvent(companyId, statement.id, "DuplicateEvaluated", { layer: "file-hash", ofStatementId: live.id }, performedBy);
    return {
      statementId: statement.id,
      status: "Duplicate",
      duplicateOfStatementId: live.id,
      message: `This statement has already been uploaded (statement #${live.id}).`,
    };
  }
  const rejected = same.find((s) => s.status === "Rejected");
  if (rejected) {
    await repo.recordSystemStatementEvent(companyId, statement.id, "DuplicateEvaluated", { layer: "file-hash", rejectedStatementId: rejected.id }, performedBy);
  }
  return { statementId: statement.id, status: "Queued", duplicateOfStatementId: null, message: null };
}

// ---------------------------------------------------------------------
// Processing (asynchronous, after the upload response)
// ---------------------------------------------------------------------

export type ProcessOutcome = "NeedsReview" | "ManualEntry" | "Failed" | "NotQueued";

export async function processStatement(companyId: string, statementId: number, performedBy: string): Promise<ProcessOutcome> {
  const claimed = await repo.claimQueuedStatement(companyId, statementId);
  if (!claimed) return "NotQueued";
  await repo.recordSystemStatementEvent(companyId, statementId, "ProcessingStarted", {}, performedBy);

  try {
    const document = await repo.getDocumentForProcessing(companyId, claimed.document_id);
    if (!document) throw new Error("The statement's original document is missing.");
    const bytes = await readSupplierOriginalBytes(document.storagePath);
    const kind = detectStatementFileType(bytes, document.filename);
    if (!kind) {
      return fail(companyId, statementId, performedBy, "pdf", "unreadable", "This file is not a PDF, image, CSV or XLSX statement.");
    }
    const outcome = await readStatementFile(bytes, kind);

    if (outcome.kind === "failed") {
      return fail(companyId, statementId, performedBy, outcome.sourceType, outcome.category, outcome.reason);
    }
    if (outcome.kind === "manual-entry") {
      await repo.updateStatementAsSystem(companyId, statementId, {
        status: "ManualEntry",
        source_type: outcome.sourceType,
        extraction_method: "manual",
        manual_entry: true,
        page_count: outcome.pageCount,
        status_reason: outcome.reason,
        validation_status: "Pending",
        validated_at: null,
      });
      await repo.recordSystemStatementEvent(companyId, statementId, "ManualEntryRequired", { sourceType: outcome.sourceType, pageCount: outcome.pageCount }, performedBy);
      return "ManualEntry";
    }

    await persistExtraction(companyId, statementId, outcome.sourceType, outcome.extraction, performedBy);
    await revalidateStatement(companyId, statementId, performedBy);
    return "NeedsReview";
  } catch (error) {
    // Never the file and never the provider/database message in the audit.
    console.error("Supplier statement processing failed.", { companyId, statementId, error: error instanceof Error ? error.name : "error" });
    return fail(companyId, statementId, performedBy, claimed.source_type, "error", "The statement could not be processed. Try again, or enter it by hand.");
  }
}

async function fail(
  companyId: string,
  statementId: number,
  performedBy: string,
  sourceType: string,
  category: string,
  reason: string,
): Promise<ProcessOutcome> {
  await repo.updateStatementAsSystem(companyId, statementId, { status: "Failed", status_reason: reason.slice(0, 500) });
  await repo.recordSystemStatementEvent(companyId, statementId, "ExtractionFailed", { category, sourceType }, performedBy);
  return "Failed";
}

async function persistExtraction(
  companyId: string,
  statementId: number,
  sourceType: string,
  extraction: StatementExtraction,
  performedBy: string,
): Promise<void> {
  const h = extraction.header;
  const { suppliers, accountNumbers } = await repo.listSuppliersForMatching(companyId);
  const proposal = proposeStatementSupplier(
    { supplierName: h.supplierName, vatNumber: h.supplierVatNumber, registrationNumber: h.supplierRegistrationNumber, accountNumber: h.accountNumber },
    suppliers,
    accountNumbers,
  );

  await repo.replaceLinesAsSystem(
    companyId,
    statementId,
    extraction.lines.map((l) => ({
      line_order: l.lineOrder,
      page_number: l.pageNumber,
      row_on_page: l.rowOnPage,
      transaction_date: l.transactionDate,
      reference_text: l.referenceText,
      description: l.description,
      transaction_type: l.transactionType,
      type_source: l.typeSource,
      debit: l.debit,
      credit: l.credit,
      running_balance: l.runningBalance,
      raw_text: l.rawText,
      unresolved_fields: l.unresolvedFields,
      is_excluded: l.isExcluded,
      exclusion_reason: l.exclusionReason,
    })),
  );

  await repo.updateStatementAsSystem(companyId, statementId, {
    status: "NeedsReview",
    status_reason: "",
    source_type: sourceType,
    extraction_method: extraction.method,
    page_count: extraction.pageCount,
    supplier_name_extracted: h.supplierName,
    supplier_vat_extracted: h.supplierVatNumber,
    supplier_registration_extracted: h.supplierRegistrationNumber,
    account_number_extracted: h.accountNumber,
    statement_date: h.statementDate,
    period_from: h.periodFrom,
    period_to: h.periodTo,
    currency_code: h.currencyCode,
    opening_balance: h.openingBalance,
    closing_balance: h.closingBalance,
    printed_total_debits: h.printedTotalDebits,
    printed_total_credits: h.printedTotalCredits,
    printed_ageing: h.printedAgeing,
    // PROPOSED only: supplier_confirmed_at stays null until a reviewer confirms.
    supplier_id: proposal.supplierId,
    supplier_match_tier: proposal.tier,
    supplier_candidates: proposal.candidates,
    extraction_snapshot: { header: h, lines: extraction.lines, method: extraction.method, pageCount: extraction.pageCount },
    warnings: extraction.warnings,
    validation_status: "Pending",
    validated_at: null,
  });

  const transactions = extraction.lines.filter((l) => !l.isExcluded);
  await repo.recordSystemStatementEvent(
    companyId,
    statementId,
    "Extracted",
    {
      method: extraction.method,
      sourceType,
      pageCount: extraction.pageCount,
      transactions: transactions.length,
      excludedRows: extraction.lines.length - transactions.length,
      unreadLines: transactions.filter((l) => l.unresolvedFields.length > 0).length,
      warnings: extraction.warnings.length,
    },
    performedBy,
  );
  await repo.recordSystemStatementEvent(
    companyId,
    statementId,
    "SupplierProposed",
    { outcome: proposal.outcome, supplierId: proposal.supplierId, tier: proposal.tier, candidates: proposal.candidates.map((c) => c.supplierId) },
    performedBy,
  );
}

// ---------------------------------------------------------------------
// Validation (system-written, always about the values as they stand)
// ---------------------------------------------------------------------

export async function revalidateStatement(companyId: string, statementId: number, performedBy: string): Promise<string> {
  const statement = await repo.getStatementAsSystem(companyId, statementId);
  if (!statement) throw new NotFoundError(`No statement with id ${statementId}.`);
  if (statement.status !== "NeedsReview") return statement.validation_status;

  const [lines, baseCurrency] = await Promise.all([repo.listStatementLinesAsSystem(companyId, statementId), repo.getCompanyBaseCurrency(companyId)]);
  const closing = numberOrNull(statement.closing_balance);
  const similar =
    statement.supplier_id && statement.statement_date && closing !== null
      ? await repo.findSimilarStatement(companyId, statementId, statement.supplier_id, statement.statement_date, closing)
      : null;

  const report = validateStatement({
    openingBalance: numberOrNull(statement.opening_balance),
    closingBalance: closing,
    statementDate: statement.statement_date,
    periodFrom: statement.period_from,
    currencyCode: statement.currency_code,
    printedTotalDebits: numberOrNull(statement.printed_total_debits),
    printedTotalCredits: numberOrNull(statement.printed_total_credits),
    printedAgeing: statement.printed_ageing,
    signConvention: statement.sign_convention,
    baseCurrencyCode: baseCurrency,
    possibleDuplicateOf: similar,
    lines: lines.map((l) => ({
      lineOrder: l.line_order,
      pageNumber: l.page_number,
      transactionDate: l.transaction_date,
      referenceText: l.reference_text,
      debit: numberOrNull(l.debit),
      credit: numberOrNull(l.credit),
      runningBalance: numberOrNull(l.running_balance),
      unresolvedFields: l.unresolved_fields,
      isExcluded: l.is_excluded,
      exclusionReason: l.exclusion_reason,
    })),
  });

  const written = await repo.updateStatementAsSystemIfUnchanged(companyId, statementId, statement.updated_at, {
    validation_status: report.status,
    validation_findings: report.findings,
    validated_at: new Date().toISOString(),
  });
  if (!written) return "Pending";
  await repo.recordSystemStatementEvent(
    companyId,
    statementId,
    "ValidationEvaluated",
    { status: report.status, findingCount: report.findings.length, codes: [...new Set(report.findings.map((f) => f.code))] },
    performedBy,
  );
  return report.status;
}

// ---------------------------------------------------------------------
// Reviewer actions (under the reviewer's session: RLS + 0114 guard)
// ---------------------------------------------------------------------

async function requireStatement(companyId: string, statementId: number): Promise<repo.StatementRow> {
  const statement = await repo.getStatement(companyId, statementId);
  if (!statement) throw new NotFoundError(`No statement with id ${statementId}.`);
  return statement;
}

function requireEditable(statement: repo.StatementRow): void {
  if (statement.status !== "NeedsReview" && statement.status !== "ManualEntry") {
    throw new ValidationError(`This statement cannot be changed while it is ${statement.status}.`);
  }
}

function money(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e12) throw new ValidationError(`${field} must be an amount.`);
  return Math.round(n * 100) / 100;
}

function isoDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseStatementDate(String(value));
  if (!parsed.ok) throw new ValidationError(`${field} must be a valid date.`);
  return parsed.iso;
}

export type HeaderCorrection = Partial<{
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currencyCode: string | null;
  openingBalance: number | string | null;
  closingBalance: number | string | null;
  printedTotalDebits: number | string | null;
  printedTotalCredits: number | string | null;
  printedAgeing: PrintedAgeing | null;
  signConvention: SignConvention;
}>;

export async function correctStatementHeader(companyId: string, statementId: number, correction: HeaderCorrection): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  requireEditable(statement);
  const fields: repo.ReviewerStatementFields = {};
  if ("statementDate" in correction) fields.statement_date = isoDate(correction.statementDate, "Statement date");
  if ("periodFrom" in correction) fields.period_from = isoDate(correction.periodFrom, "Period start");
  if ("periodTo" in correction) fields.period_to = isoDate(correction.periodTo, "Period end");
  if ("currencyCode" in correction) {
    const code = correction.currencyCode?.trim().toUpperCase() || null;
    if (code !== null && !/^[A-Z]{3}$/.test(code)) throw new ValidationError("Currency must be a three-letter code.");
    fields.currency_code = code;
  }
  if ("openingBalance" in correction) fields.opening_balance = money(correction.openingBalance, "Opening balance");
  if ("closingBalance" in correction) fields.closing_balance = money(correction.closingBalance, "Closing balance");
  if ("printedTotalDebits" in correction) fields.printed_total_debits = money(correction.printedTotalDebits, "Printed debit total");
  if ("printedTotalCredits" in correction) fields.printed_total_credits = money(correction.printedTotalCredits, "Printed credit total");
  if ("printedAgeing" in correction) {
    const a = correction.printedAgeing;
    fields.printed_ageing = a
      ? {
          current: money(a.current, "Current"),
          days30: money(a.days30, "30 days"),
          days60: money(a.days60, "60 days"),
          days90: money(a.days90, "90 days"),
          days120Plus: money(a.days120Plus, "120+ days"),
        }
      : null;
  }
  if ("signConvention" in correction) {
    if (correction.signConvention !== "debit-increases-owed" && correction.signConvention !== "credit-increases-owed") {
      throw new ValidationError("Unknown debit/credit convention.");
    }
    fields.sign_convention = correction.signConvention;
  }
  if (Object.keys(fields).length === 0) return;

  await repo.updateStatementAsReviewer(companyId, statementId, fields);
  await repo.recordStatementEvent(companyId, statementId, "FieldCorrected", { fields: Object.keys(fields) });
  await revalidateStatement(companyId, statementId, await getPerformedByLabel());
}

const TYPES: ReadonlySet<string> = new Set<StatementTransactionType>([
  "invoice", "credit-note", "debit-note", "payment", "opening", "interest", "adjustment", "other", "unknown",
]);

export type LineInput = Partial<{
  transactionDate: string | null;
  referenceText: string | null;
  description: string | null;
  transactionType: StatementTransactionType;
  debit: number | string | null;
  credit: number | string | null;
  runningBalance: number | string | null;
  isExcluded: boolean;
}>;

function lineFields(input: LineInput): repo.ReviewerLineFields {
  const fields: repo.ReviewerLineFields = {};
  if ("transactionDate" in input) fields.transaction_date = isoDate(input.transactionDate, "Line date");
  // References are kept exactly as the reviewer types them (trimmed only):
  // leading zeros are part of the reference.
  if ("referenceText" in input) fields.reference_text = input.referenceText?.trim() || null;
  if ("description" in input) fields.description = input.description?.trim() || null;
  if ("transactionType" in input) {
    if (!input.transactionType || !TYPES.has(input.transactionType)) throw new ValidationError("Unknown line type.");
    fields.transaction_type = input.transactionType;
  }
  if ("debit" in input) fields.debit = money(input.debit, "Debit");
  if ("credit" in input) fields.credit = money(input.credit, "Credit");
  if ("runningBalance" in input) fields.running_balance = money(input.runningBalance, "Balance");
  if ("isExcluded" in input) fields.is_excluded = input.isExcluded === true;
  for (const key of ["debit", "credit"] as const) {
    const v = fields[key];
    if (v !== undefined && v !== null && v < 0) throw new ValidationError(`${key === "debit" ? "Debit" : "Credit"} cannot be negative; use the other column.`);
  }
  return fields;
}

export async function correctStatementLines(
  companyId: string,
  statementId: number,
  changes: { update?: (LineInput & { lineId: number })[]; add?: LineInput[]; remove?: number[] },
): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  requireEditable(statement);
  const updates = changes.update ?? [];
  for (const update of updates) {
    const fields = lineFields(update);
    if (Object.keys(fields).length > 0) await repo.updateLineAsReviewer(companyId, statementId, update.lineId, fields);
  }
  for (const lineId of changes.remove ?? []) await repo.removeLineAsReviewer(companyId, statementId, lineId);
  const added = (changes.add ?? []).map(lineFields);
  await repo.addLinesAsReviewer(companyId, statementId, added);

  if (updates.length > 0) await repo.recordStatementEvent(companyId, statementId, "LineCorrected", { lines: updates.map((u) => u.lineId) });
  if (added.length > 0) await repo.recordStatementEvent(companyId, statementId, "LineAdded", { count: added.length });
  if ((changes.remove ?? []).length > 0) await repo.recordStatementEvent(companyId, statementId, "LineRemoved", { lines: changes.remove });
  await revalidateStatement(companyId, statementId, await getPerformedByLabel());
}

export async function startStatementManualEntry(companyId: string, statementId: number): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  if (statement.status !== "Queued" && statement.status !== "Failed") {
    throw new ValidationError(`Only a statement waiting to be read, or one that could not be read, can be entered by hand (this one is ${statement.status}).`);
  }
  await repo.updateStatementAsReviewer(companyId, statementId, { status: "ManualEntry" });
  await repo.recordStatementEvent(companyId, statementId, "ManualEntryStarted", { from: statement.status });
}

export async function submitStatementForReview(companyId: string, statementId: number): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  if (statement.status !== "ManualEntry") {
    throw new ValidationError(`Only a statement being entered by hand can be submitted for review (this one is ${statement.status}).`);
  }
  await repo.updateStatementAsReviewer(companyId, statementId, { status: "NeedsReview" });
  await repo.recordStatementEvent(companyId, statementId, "SubmittedForReview", {});
  await revalidateStatement(companyId, statementId, await getPerformedByLabel());
}

/**
 * The reviewer CONFIRMS whose statement this is (mandatory before Ready,
 * whatever matched). Optionally records the statement's account number on
 * that supplier for future matching — an explicit, audited supplier edit.
 */
export async function confirmStatementSupplier(
  companyId: string,
  statementId: number,
  supplierId: number,
  options: { saveAccountNumber?: boolean } = {},
): Promise<void> {
  if (!Number.isInteger(supplierId) || supplierId <= 0) throw new ValidationError("Choose a supplier to confirm.");
  const statement = await requireStatement(companyId, statementId);
  requireEditable(statement);
  const changed = statement.supplier_id !== supplierId;
  await repo.updateStatementAsReviewer(companyId, statementId, { supplier_id: supplierId, supplier_confirmed_at: new Date().toISOString() });
  await repo.recordStatementEvent(companyId, statementId, "SupplierConfirmed", { supplierId, proposedSupplierId: statement.supplier_id, changed });

  if (options.saveAccountNumber) {
    const accountNumber = statement.account_number_extracted?.trim();
    if (!accountNumber) throw new ValidationError("The statement shows no account number to save.");
    await setSupplierOurAccountNumber(companyId, supplierId, accountNumber, await getPerformedByLabel(), `Saved from supplier statement #${statementId}.`);
    await repo.recordStatementEvent(companyId, statementId, "SupplierAccountNumberSaved", { supplierId });
  }
  if (changed) await revalidateStatement(companyId, statementId, await getPerformedByLabel());
}

export async function unconfirmStatementSupplier(companyId: string, statementId: number): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  requireEditable(statement);
  if (!statement.supplier_confirmed_at) return;
  await repo.updateStatementAsReviewer(companyId, statementId, { supplier_confirmed_at: null });
  await repo.recordStatementEvent(companyId, statementId, "SupplierUnconfirmed", { supplierId: statement.supplier_id });
}

export async function markStatementReady(companyId: string, statementId: number): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  if (statement.status !== "NeedsReview") throw new ValidationError(`Only a statement in review can be marked ready (this one is ${statement.status}).`);
  if (statement.validation_status !== "Pass" && statement.validation_status !== "Review") {
    throw new ValidationError("The statement must add up before it is ready. Resolve the validation findings first.");
  }
  if (!statement.supplier_id || !statement.supplier_confirmed_at) throw new ValidationError("Confirm the supplier before marking the statement ready.");
  // The database re-checks all of this, plus currency and unread values.
  await repo.updateStatementAsReviewer(companyId, statementId, { status: "Ready" });
  await repo.recordStatementEvent(companyId, statementId, "MarkedReady", {});
}

export async function reopenStatement(companyId: string, statementId: number): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  if (statement.status !== "Ready") throw new ValidationError(`Only a ready statement can be reopened (this one is ${statement.status}).`);
  await repo.updateStatementAsReviewer(companyId, statementId, { status: "NeedsReview" });
  await repo.recordStatementEvent(companyId, statementId, "Reopened", {});
}

export async function rejectStatement(companyId: string, statementId: number, reason: string): Promise<void> {
  const statement = await requireStatement(companyId, statementId);
  if (statement.status === "Rejected") return;
  const why = reason.trim();
  if (why.length < 3) throw new ValidationError("Give a reason for rejecting the statement.");
  await repo.updateStatementAsReviewer(companyId, statementId, { status: "Rejected" });
  // The reason is the reviewer's own words about the decision, not
  // statement content.
  await repo.recordStatementEvent(companyId, statementId, "Rejected", { reason: why.slice(0, 300), from: statement.status });
}

/** Ask for a Queued statement to be processed again (e.g. the processing
 * after its upload never ran), or recover one stuck in Processing. */
export async function requeueStatement(companyId: string, statementId: number): Promise<"Queued"> {
  const statement = await requireStatement(companyId, statementId);
  if (statement.status === "Processing") {
    const stale = await repo.requeueStaleProcessing(companyId, statementId, new Date(Date.now() - STALE_PROCESSING_MS).toISOString());
    if (!stale) throw new ValidationError("This statement is being read now. Try again in a few minutes.");
  } else if (statement.status !== "Queued") {
    throw new ValidationError(`Only a statement waiting to be read can be queued again (this one is ${statement.status}).`);
  }
  await repo.recordStatementEvent(companyId, statementId, "ProcessingRequeued", { from: statement.status });
  return "Queued";
}

// ---------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------

export type StatementSummary = {
  id: number;
  status: StatementStatus;
  statusReason: string;
  sourceType: string;
  supplierId: number | null;
  supplierConfirmed: boolean;
  supplierNameExtracted: string | null;
  accountNumberExtracted: string | null;
  statementDate: string | null;
  closingBalance: number | null;
  currencyCode: string | null;
  validationStatus: string;
  createdAt: string;
};

function summary(row: repo.StatementRow): StatementSummary {
  return {
    id: row.id,
    status: row.status,
    statusReason: row.status_reason,
    sourceType: row.source_type,
    supplierId: row.supplier_id,
    supplierConfirmed: row.supplier_confirmed_at !== null,
    supplierNameExtracted: row.supplier_name_extracted,
    accountNumberExtracted: row.account_number_extracted,
    statementDate: row.statement_date,
    closingBalance: numberOrNull(row.closing_balance),
    currencyCode: row.currency_code,
    validationStatus: row.validation_status,
    createdAt: row.created_at,
  };
}

export async function listSupplierStatements(companyId: string, options: { status?: StatementStatus; limit?: number } = {}): Promise<StatementSummary[]> {
  return (await repo.listStatements(companyId, options)).map(summary);
}

export async function getSupplierStatement(companyId: string, statementId: number) {
  const statement = await repo.getStatement(companyId, statementId);
  if (!statement) return null;
  const [lines, events, baseCurrency] = await Promise.all([
    repo.listStatementLines(companyId, statementId),
    repo.listStatementEvents(companyId, statementId),
    repo.getCompanyBaseCurrency(companyId),
  ]);
  return {
    statement: {
      ...summary(statement),
      documentId: statement.document_id,
      extractionMethod: statement.extraction_method,
      supplierMatchTier: statement.supplier_match_tier,
      supplierCandidates: statement.supplier_candidates,
      supplierConfirmedBy: statement.supplier_confirmed_by,
      supplierConfirmedAt: statement.supplier_confirmed_at,
      supplierVatExtracted: statement.supplier_vat_extracted,
      supplierRegistrationExtracted: statement.supplier_registration_extracted,
      periodFrom: statement.period_from,
      periodTo: statement.period_to,
      openingBalance: numberOrNull(statement.opening_balance),
      printedTotalDebits: numberOrNull(statement.printed_total_debits),
      printedTotalCredits: numberOrNull(statement.printed_total_credits),
      printedAgeing: statement.printed_ageing,
      signConvention: statement.sign_convention,
      pageCount: statement.page_count,
      validationFindings: statement.validation_findings,
      warnings: statement.warnings,
      manualEntry: statement.manual_entry,
      duplicateOfStatementId: statement.duplicate_of_statement_id,
      /** Owner decision: a statement in another currency is refused for
       * reconciliation and marked for manual review. */
      currencySupported: statement.currency_code === null || statement.currency_code === baseCurrency,
    },
    lines: lines.map((l) => ({
      id: l.id,
      lineOrder: l.line_order,
      pageNumber: l.page_number,
      rowOnPage: l.row_on_page,
      transactionDate: l.transaction_date,
      referenceText: l.reference_text,
      description: l.description,
      transactionType: l.transaction_type,
      typeSource: l.type_source,
      debit: numberOrNull(l.debit),
      credit: numberOrNull(l.credit),
      amount: numberOrNull(l.amount),
      runningBalance: numberOrNull(l.running_balance),
      rawText: l.raw_text,
      unresolvedFields: l.unresolved_fields,
      isExcluded: l.is_excluded,
      exclusionReason: l.exclusion_reason,
      corrected: l.corrected,
    })),
    events: events.map((e) => ({ id: e.id, type: e.event_type, detail: e.detail, performedBy: e.performed_by, occurredAt: e.occurred_at })),
  };
}
