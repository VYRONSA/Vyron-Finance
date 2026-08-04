/**
 * Domain types for the Import Centre module (Migration Roadmap Module 3) —
 * ported from `import_centre/models.py` and `bank_import/models.py`. Only
 * the CSV-only, Standard-Template import path is in scope: Xero-style
 * Bills/Credit Notes CSV and the VYRON Standard Bank Import Template CSV.
 * The reference app's PDF bank-statement parsers and legacy .xlsx-only
 * `importer/` package are explicitly out of scope.
 */

export type DocumentType = "Bill" | "Credit Note";

export type ParsedBillTransaction = {
  supplier: string;
  invoiceNumber: string;
  reference: string;
  documentType: DocumentType;
  invoiceDate: string | null;
  dueDate: string | null;
  status: string;
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  amountDue: number;
  trackingCategory: string;
  sourceFilename: string;
  importBatch: string;
  rowNumber: number;
  /** False when Subtotal + VAT != Total for this row beyond rounding
   * tolerance — the row is still imported, but flagged. */
  vatReconciles: boolean;
};

export type ParsedBankTransaction = {
  transactionDate: string | null;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  balance: number | null;
  bankAccount: string;
  /** Passed through as supplied — never calculated. */
  vat: number | null;
  glAccount: string;
  notes: string;
  sourceFilename: string;
  importBatch: string;
  rowNumber: number;
};

export type ImportExceptionRecord = {
  sourceFilename: string;
  rowNumber: number;
  exceptionType: string;
  description: string;
  supplier?: string;
  invoiceNumber?: string;
  beneficiary?: string;
};

export type FileImportOutcome = {
  filename: string;
  documentTypeDetected: DocumentType | null;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
};

export type BankFileImportOutcome = {
  filename: string;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
};

export type BillsParseResult = {
  transactions: ParsedBillTransaction[];
  exceptions: ImportExceptionRecord[];
  outcome: FileImportOutcome;
};

export type BankStatementParseResult = {
  transactions: ParsedBankTransaction[];
  exceptions: ImportExceptionRecord[];
  outcome: BankFileImportOutcome;
};
