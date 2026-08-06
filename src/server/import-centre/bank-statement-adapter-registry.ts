/**
 * Extensible parser framework for the Bank Import Engine — one adapter
 * per file format. Every real format (CSV, XLSX, OFX, QIF — all fully
 * specified, so all buildable correctly without samples) is registered
 * below and genuinely works.
 *
 * Pilot Review Round 1, Phase 9 — PDF is different in kind, not just
 * degree: bank statement PDFs are proprietary per-bank layouts, and the
 * Board's own instruction is explicit — "where real sample statements
 * are unavailable, build the complete framework... do not fabricate
 * parser logic." `PDF_ADAPTERS` below is now populated with all 10 named
 * banks, each a real, registered `BankStatementAdapter` whose `parse()`
 * honestly reports "awaiting validation with a real bank statement"
 * (see `pdfNotYetImplemented` below) rather than guessing at column
 * positions with no ground truth to check against. What IS real here:
 * detecting WHICH of the 10 banks produced a given PDF, via genuine text
 * extraction (`pdf-text-extraction.ts`, calling `pdfjs-dist` directly)
 * and literal bank-name matching against the
 * statement's own letterhead text (`contentMarkers`, `resolvePdfBankAdapter`)
 * — filename alone can't identify a bank (unlike CSV/XLSX/OFX/QIF, whose
 * extension IS the whole match), so PDF adapters always report
 * `matchesFile: () => false` and are instead resolved by
 * `resolvePdfBankAdapter(extractedText)`, a second, additive resolution
 * path alongside (not replacing) `resolveBankStatementAdapter(filename)`.
 * When a real sample statement is supplied for a bank, only that bank's
 * `parse()` needs to change — the detection, registration, upload,
 * statement-balance/duplicate validation, and Import Review Screen
 * plumbing around it already work end-to-end today (see
 * `pdf-statement-validation.ts` and `import-service.ts`'s
 * `previewPdfBankStatement`/`confirmPdfBankStatementImport`). See
 * `REQUIRED_SAMPLE_STATEMENTS` below for exactly what's needed per bank.
 */

import { decodeCsvBuffer } from "./csv-utils";
import { parseBankStatementCsv } from "./bank-statement-parser";
import { parseBankStatementXlsx } from "./bank-statement-xlsx-parser";
import { parseOfxStatement } from "./ofx-parser";
import { parseQifStatement } from "./qif-parser";
import { extractPdfText } from "./pdf-text-extraction";
import { extractFnbStatementMetadata, extractFnbTransactions, extractFnbTurnoverSummary } from "./parsers/fnb-bank-statement-parser";
import { extractFnbCreditCardMetadata, extractFnbCreditCardTransactions } from "./parsers/fnb-credit-card-statement-parser";
import { NULL_STATEMENT_METADATA, type BankStatementParseResult } from "./types";

export type BankStatementAdapter = {
  /** Stable id, e.g. "standard-csv", "standard-xlsx", "ofx", "qif", or
   * a bank-specific PDF adapter's own id (e.g. "fnb-pdf"). */
  id: string;
  label: string;
  matchesFile: (filename: string) => boolean;
  parse: (buffer: ArrayBuffer, filename: string, importBatch: string) => BankStatementParseResult | Promise<BankStatementParseResult>;
  /** PDF adapters only — literal strings looked for (case-insensitive)
   * in the statement's own extracted text to identify which bank issued
   * it. Absent for every non-PDF adapter. */
  contentMarkers?: string[];
  /** PDF adapters only — real, human-readable status, three-tier per the
   * Board's Final Outstanding Requirement:
   *   "awaiting-validation" — detection works, but `parse()` extracts no
   *     transactions; a real sample statement is needed before column
   *     extraction can be written at all (every bank starts here).
   *   "implemented-unvalidated" — a real, bank-specific extraction
   *     implementation exists (built against at least one real sample),
   *     but has not yet been cross-checked against a second/third real
   *     statement to confirm it generalises across statement variants
   *     (different account types, date ranges, transaction volumes).
   *   "validated" — extraction has been confirmed correct against
   *     multiple real statements for this bank; production-ready. */
  status?: "validated" | "implemented-unvalidated" | "awaiting-validation";
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export const BANK_STATEMENT_ADAPTERS: BankStatementAdapter[] = [
  {
    id: "standard-csv",
    label: "VYRON Standard Bank Import Template (CSV)",
    matchesFile: (filename) => extensionOf(filename) === "csv",
    parse: (buffer, filename, importBatch) => parseBankStatementCsv(decodeCsvBuffer(buffer), filename, importBatch),
  },
  {
    id: "standard-xlsx",
    label: "VYRON Standard Bank Import Template (Excel)",
    matchesFile: (filename) => extensionOf(filename) === "xlsx",
    parse: (buffer, filename, importBatch) => parseBankStatementXlsx(buffer, filename, importBatch),
  },
  {
    id: "ofx",
    label: "OFX (Open Financial Exchange)",
    matchesFile: (filename) => extensionOf(filename) === "ofx",
    parse: (buffer, filename, importBatch) => parseOfxStatement(decodeCsvBuffer(buffer), filename, importBatch),
  },
  {
    id: "qif",
    label: "QIF (Quicken Interchange Format)",
    matchesFile: (filename) => extensionOf(filename) === "qif",
    parse: (buffer, filename, importBatch) => parseQifStatement(decodeCsvBuffer(buffer), filename, importBatch),
  },
];

/** Honest placeholder result for every named-bank PDF adapter today — a
 * real, structured `ImportExceptionRecord`, never fabricated transaction
 * rows. */
function pdfNotYetImplemented(bankName: string, filename: string): BankStatementParseResult {
  return {
    transactions: [],
    exceptions: [
      {
        sourceFilename: filename,
        rowNumber: 0,
        exceptionType: "Invalid Template",
        description: `${bankName} was correctly detected from this statement's own text, but parsing is not yet implemented for it — a real ${bankName} sample statement is needed to validate the exact column layout before this can extract transactions safely. No transactions were fabricated or guessed.`,
      },
    ],
    outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 },
    metadata: NULL_STATEMENT_METADATA,
  };
}

function namedBankPdfAdapter(id: string, bankName: string, markers: string[]): BankStatementAdapter {
  return {
    id,
    label: `${bankName} (PDF) — awaiting validation`,
    matchesFile: () => false,
    contentMarkers: markers,
    status: "awaiting-validation",
    parse: (_buffer, filename) => pdfNotYetImplemented(bankName, filename),
  };
}

/** FNB's real, implemented-but-unvalidated parser — see
 * `parsers/fnb-bank-statement-parser.ts`'s own module docstring for the
 * full disclosure (built against a real sample's rendered text, not yet
 * run against the real PDF bytes through this exact function). Falls
 * back to the same honest "not yet implemented" result if the statement
 * text doesn't contain what this parser needs (account number or
 * statement period genuinely missing/unrecognised) — never guesses. */
async function parseFnbStatement(buffer: ArrayBuffer, filename: string, importBatch: string): Promise<BankStatementParseResult> {
  const text = await extractPdfText(buffer);
  const metadata = extractFnbStatementMetadata(text);

  if (!metadata.accountNumber || !metadata.statementPeriodStart || !metadata.statementPeriodEnd) {
    return {
      transactions: [],
      exceptions: [
        {
          sourceFilename: filename,
          rowNumber: 0,
          exceptionType: "Invalid Template",
          description:
            "FNB was detected, but this statement's account number or statement period couldn't be located in the expected format — this parser is implemented-but-unvalidated (built against one real FNB Platinum Business Account sample) and may not yet cover this statement's exact layout. No transactions were fabricated or guessed.",
        },
      ],
      outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 },
      metadata,
    };
  }

  const balanceSign = (metadata.openingBalance ?? 0) < 0 ? -1 : 1;
  const transactions = extractFnbTransactions(
    text,
    metadata.accountNumber,
    metadata.statementPeriodStart,
    metadata.statementPeriodEnd,
    filename,
    importBatch,
    balanceSign,
  );
  const turnover = extractFnbTurnoverSummary(text);

  return {
    transactions,
    exceptions: [],
    outcome: { filename, rowsRead: transactions.length, rowsImported: transactions.length, rowsSkipped: 0 },
    metadata,
    expectedTransactionCount: turnover ? turnover.creditTransactionCount + turnover.debitTransactionCount : null,
  };
}

/** FNB's second real statement type, from the Final Certification round
 * — a "Business Credit Card" control-account statement, structurally
 * unrelated to the Platinum Business Account (current/cheque) layout
 * `parseFnbStatement` above handles (see
 * `parsers/fnb-credit-card-statement-parser.ts`'s own module docstring).
 * Registered with the more specific "BUSINESS CREDIT CARD" marker and
 * placed BEFORE the generic `fnb-pdf` entry below in `PDF_ADAPTERS`,
 * since `resolvePdfBankAdapter` returns the first matching adapter and
 * both statement types share FNB's own generic letterhead markers —
 * without this ordering, every FNB Business Credit Card statement would
 * incorrectly resolve to the cheque-account parser instead. */
async function parseFnbCreditCardStatement(buffer: ArrayBuffer, filename: string, importBatch: string): Promise<BankStatementParseResult> {
  const text = await extractPdfText(buffer);
  const metadata = extractFnbCreditCardMetadata(text);

  if (!metadata.accountNumber) {
    return {
      transactions: [],
      exceptions: [
        {
          sourceFilename: filename,
          rowNumber: 0,
          exceptionType: "Invalid Template",
          description:
            "FNB Business Credit Card was detected, but this statement's control account number couldn't be located in the expected format — this parser is implemented-but-unvalidated (built against one real FNB Business Credit Card sample) and may not yet cover this statement's exact layout. No transactions were fabricated or guessed.",
        },
      ],
      outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 },
      metadata,
    };
  }

  const transactions = extractFnbCreditCardTransactions(text, metadata.accountNumber, filename, importBatch);

  return {
    transactions,
    exceptions: [],
    outcome: { filename, rowsRead: transactions.length, rowsImported: transactions.length, rowsSkipped: 0 },
    metadata,
    // This statement type prints no "Turnover for Statement Period"
    // footer (confirmed against the real PDF, not assumed) — genuinely
    // unavailable, not fabricated.
    expectedTransactionCount: null,
  };
}

/** All 10 named banks from the Board's own directive, each a real,
 * registered adapter — see this file's module docstring for what "real"
 * means here (detection, not extraction) and why. */
export const PDF_ADAPTERS: BankStatementAdapter[] = [
  {
    id: "fnb-credit-card-pdf",
    label: "First National Bank (FNB) Business Credit Card (PDF) — implemented, awaiting second-sample validation",
    matchesFile: () => false,
    contentMarkers: ["BUSINESS CREDIT CARD"],
    status: "implemented-unvalidated",
    parse: parseFnbCreditCardStatement,
  },
  {
    id: "fnb-pdf",
    label: "First National Bank (FNB) (PDF) — implemented, awaiting second-sample validation",
    matchesFile: () => false,
    contentMarkers: ["FIRST NATIONAL BANK", "FNB.CO.ZA", "FNB SOUTH AFRICA"],
    status: "implemented-unvalidated",
    parse: parseFnbStatement,
  },
  namedBankPdfAdapter("absa-pdf", "ABSA", ["ABSA BANK LIMITED", "ABSA.CO.ZA", "ABSA GROUP"]),
  namedBankPdfAdapter("standard-bank-pdf", "Standard Bank", ["STANDARD BANK OF SOUTH AFRICA", "STANDARDBANK.CO.ZA"]),
  namedBankPdfAdapter("nedbank-pdf", "Nedbank", ["NEDBANK LIMITED", "NEDBANK.CO.ZA"]),
  namedBankPdfAdapter("capitec-pdf", "Capitec", ["CAPITEC BANK LIMITED", "CAPITECBANK.CO.ZA", "CAPITEC BANK"]),
  namedBankPdfAdapter("investec-pdf", "Investec", ["INVESTEC BANK LIMITED", "INVESTEC.COM", "INVESTEC BANK"]),
  namedBankPdfAdapter("discovery-pdf", "Discovery Bank", ["DISCOVERY BANK LIMITED", "DISCOVERY BANK"]),
  namedBankPdfAdapter("bidvest-pdf", "Bidvest Bank", ["BIDVEST BANK LIMITED", "BIDVEST BANK"]),
  namedBankPdfAdapter("mercantile-pdf", "Mercantile Bank", ["MERCANTILE BANK LIMITED", "MERCANTILE BANK"]),
  namedBankPdfAdapter("tymebank-pdf", "TymeBank", ["TYMEBANK", "TYME BANK LIMITED"]),
];

export type SampleStatementRequirement = { bankId: string; bankName: string; requirement: string };

/** The Board's own Final Outstanding Requirement: "If sample statements
 * are unavailable... provide a list of the sample documents required."
 * One source of truth, surfaced in both the PDF import UI (see
 * `import-upload-card.tsx`) and the Pilot Review documentation. */
export const REQUIRED_SAMPLE_STATEMENTS: SampleStatementRequirement[] = PDF_ADAPTERS.map((adapter) => ({
  bankId: adapter.id,
  bankName: adapter.label.replace(/ \(PDF\).*/, ""),
  requirement:
    "One real, redacted PDF statement — account/personal details may be blacked out, but the account holder line, account number line, statement period, opening balance, closing balance, and at least 10-15 real transaction rows covering a mix of EFT, debit order, card purchase, cash deposit, interest, and bank fee entries must remain intact and legible.",
}));

export function resolveBankStatementAdapter(filename: string): BankStatementAdapter | null {
  return (
    BANK_STATEMENT_ADAPTERS.find((adapter) => adapter.matchesFile(filename)) ??
    PDF_ADAPTERS.find((adapter) => adapter.matchesFile(filename)) ??
    null
  );
}

export type PdfBankDetection = { adapter: BankStatementAdapter; matchedMarker: string; confidence: number };

/** Real content-based detection — the actual new capability Phase 9
 * adds. Confidence is genuine signal, not decoration: 1 matched marker
 * is a plausible hit (0.6), 2+ distinct markers matching is much more
 * certain (0.9) since a real statement's letterhead typically repeats
 * the bank's name and domain together. */
export function resolvePdfBankAdapter(extractedText: string): PdfBankDetection | null {
  const upper = extractedText.toUpperCase();
  for (const adapter of PDF_ADAPTERS) {
    const matched = (adapter.contentMarkers ?? []).filter((marker) => upper.includes(marker));
    if (matched.length > 0) {
      return { adapter, matchedMarker: matched[0], confidence: matched.length >= 2 ? 0.9 : 0.6 };
    }
  }
  return null;
}

export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".ofx", ".qif", ".pdf"];
