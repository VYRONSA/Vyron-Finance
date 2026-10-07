/**
 * SD-3C — supplier statements: the shapes every reader produces.
 *
 * PDF is the primary source; JPEG/PNG scans are entered by hand in SD-3C
 * (no OCR exists yet — see docs/SUPPLIER_DOCUMENT_INTELLIGENCE_SD3A_DESIGN.md
 * §16.1; the model below is provider-agnostic so OCR/vision extraction can
 * produce it later without a redesign); CSV/XLSX are secondary adapters that
 * produce exactly the same shape. Validation, review and (SD-3D)
 * reconciliation never care which reader produced a statement.
 */

export type StatementSourceType = "pdf" | "pdf-text" | "pdf-scanned" | "pdf-mixed" | "image" | "csv" | "xlsx";

export type StatementStatus = "Queued" | "Processing" | "ManualEntry" | "NeedsReview" | "Ready" | "Duplicate" | "Failed" | "Rejected";

export type StatementValidationStatus = "Pending" | "Pass" | "Review" | "Incomplete";

export type SignConvention = "debit-increases-owed" | "credit-increases-owed";

export type StatementTransactionType =
  | "invoice"
  | "credit-note"
  | "debit-note"
  | "payment"
  | "opening"
  | "interest"
  | "adjustment"
  | "other"
  | "unknown";

/** A structured value the reader could not interpret reliably. The value is
 * left empty, the raw text is kept, and the statement cannot validate until
 * a reviewer resolves it against the original. Never guessed. */
export type UnresolvedField = "transaction_date" | "reference_text" | "debit" | "credit" | "running_balance" | "transaction_type";

/** Why a kept row is not a transaction. */
export type ExclusionReason = "brought-forward" | "carried-forward" | "page-total" | "subtotal" | "statement-total" | "closing-balance";

export type ExtractedStatementLine = {
  lineOrder: number;
  pageNumber: number | null;
  rowOnPage: number | null;
  /** ISO yyyy-mm-dd. */
  transactionDate: string | null;
  /** EXACTLY as printed (trimmed only): leading zeros, spaces and
   * punctuation preserved. Matching keys are derived from it later. */
  referenceText: string | null;
  description: string | null;
  transactionType: StatementTransactionType;
  typeSource: "printed" | "inferred";
  debit: number | null;
  credit: number | null;
  runningBalance: number | null;
  /** The row as read, for the reviewer. */
  rawText: string;
  unresolvedFields: UnresolvedField[];
  isExcluded: boolean;
  exclusionReason: ExclusionReason | null;
};

export type PrintedAgeing = {
  current: number | null;
  days30: number | null;
  days60: number | null;
  days90: number | null;
  days120Plus: number | null;
};

export type StatementHeader = {
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierRegistrationNumber: string | null;
  /** Our account number at the supplier, verbatim. */
  accountNumber: string | null;
  statementDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currencyCode: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  printedTotalDebits: number | null;
  printedTotalCredits: number | null;
  printedAgeing: PrintedAgeing | null;
};

export type StatementExtraction = {
  method: "layout" | "tabular";
  pageCount: number | null;
  header: StatementHeader;
  lines: ExtractedStatementLine[];
  /** Plain-language notes for the reviewer (never statement amounts). */
  warnings: string[];
};

export const EMPTY_HEADER: StatementHeader = {
  supplierName: null,
  supplierVatNumber: null,
  supplierRegistrationNumber: null,
  accountNumber: null,
  statementDate: null,
  periodFrom: null,
  periodTo: null,
  currencyCode: null,
  openingBalance: null,
  closingBalance: null,
  printedTotalDebits: null,
  printedTotalCredits: null,
  printedAgeing: null,
};
