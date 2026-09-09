/**
 * Domain types for the Import Centre module (Migration Roadmap Module 3) —
 * ported from `import_centre/models.py` and `bank_import/models.py`.
 * Originally CSV-only; Pilot Review Round 1 added real XLSX/OFX/QIF
 * parsers and the PDF bank-statement framework (see
 * `bank-statement-adapter-registry.ts`'s own docstring for what "real" vs
 * "framework-only" means for PDF specifically).
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

/** Statement-level facts, distinct from any one transaction row — the
 * PDF Bank Statement Import requirement's own field list (account
 * holder, account number, statement period, opening/closing balance).
 * Every field is nullable: CSV/XLSX/OFX/QIF statements don't carry this
 * information at all (null throughout, not fabricated), and a PDF
 * adapter that can't find a given field in the statement's text reports
 * it as null rather than guessing. */
export type BankStatementMetadata = {
  accountHolder: string | null;
  accountNumber: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Final Certification round (real FNB PDFs) — the Board's header
   * field list also names Statement Number, Credit Limit, Available
   * Balance, Interest information, VAT, and Fees, none of which the
   * original 6-field shape above had room for. Every field here is the
   * same "null when genuinely not printed/found, never guessed"
   * contract as the rest of this type. `interestSummary` is text, not a
   * single number, because a real statement prints more than one rate
   * (e.g. separate Purchases/Cash/Petrol rates, or a Credit vs. Debit
   * rate pair) — collapsing that to one number would be lossy. */
  statementNumber: string | null;
  creditLimit: number | null;
  availableBalance: number | null;
  interestSummary: string | null;
  vat: number | null;
  fees: number | null;
  /** Final Certification round — confirmed as a real, generalisable
   * defect once the FNB Business Credit Card statement was reconciled:
   * `reconcileStatementBalances` previously assumed every statement is
   * an asset (a credit row always increases the tracked value, a debit
   * always decreases it) — correct for a bank/cheque account, wrong for
   * a credit-card liability, where a debit (a new charge) increases
   * what's owed and a credit (a payment) decreases it. `null`/absent is
   * treated as `"asset"` for backward compatibility with every existing
   * bank-account-style parser. */
  balancePolarity?: "asset" | "liability" | null;
};

export const NULL_STATEMENT_METADATA: BankStatementMetadata = {
  accountHolder: null,
  accountNumber: null,
  statementPeriodStart: null,
  statementPeriodEnd: null,
  openingBalance: null,
  closingBalance: null,
  statementNumber: null,
  creditLimit: null,
  availableBalance: null,
  interestSummary: null,
  vat: null,
  fees: null,
};

export type BankStatementParseResult = {
  transactions: ParsedBankTransaction[];
  exceptions: ImportExceptionRecord[];
  outcome: BankFileImportOutcome;
  /** Absent (treated as `NULL_STATEMENT_METADATA`) for every format that
   * doesn't carry statement-level facts — the existing CSV/XLSX/OFX/QIF
   * parsers were deliberately left unchanged rather than each threaded
   * with a field they have nothing real to populate. Only PDF adapters
   * set this. */
  metadata?: BankStatementMetadata;
  /** The statement's own printed transaction count, when it has one
   * (e.g. FNB's "Turnover for Statement Period" summary) — powers the
   * "missing transactions" validation check. `undefined`/`null` for
   * every format/bank that doesn't print one; never invented. */
  expectedTransactionCount?: number | null;
};
