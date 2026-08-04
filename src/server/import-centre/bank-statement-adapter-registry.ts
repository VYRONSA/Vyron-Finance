/**
 * Extensible parser framework for the Bank Import Engine — one adapter
 * per file format. Every real format (CSV, XLSX, OFX, QIF — all fully
 * specified, so all buildable correctly without samples) is registered
 * below and genuinely works. PDF is NOT: bank statement PDFs are
 * proprietary per-bank layouts, and the Product Review Board's own
 * directive is explicit that "examples will be supplied later" — writing
 * a PDF text-column parser now, with no real bank statement to validate
 * it against, would risk exactly the kind of "looks like it works but
 * doesn't" fabrication this codebase has been disciplined about avoiding
 * everywhere else. `PDF_ADAPTERS` is therefore a real, empty extension
 * point: when example PDFs are supplied, a new adapter implementing
 * `BankStatementAdapter` (bankName, matchesFile, parse) drops into that
 * array and the import route above it needs no changes at all — that's
 * the whole point of the adapter shape.
 */

import { decodeCsvBuffer } from "./csv-utils";
import { parseBankStatementCsv } from "./bank-statement-parser";
import { parseBankStatementXlsx } from "./bank-statement-xlsx-parser";
import { parseOfxStatement } from "./ofx-parser";
import { parseQifStatement } from "./qif-parser";
import type { BankStatementParseResult } from "./types";

export type BankStatementAdapter = {
  /** Stable id, e.g. "standard-csv", "standard-xlsx", "ofx", "qif". A
   * future bank-specific PDF adapter would use its own bank's name here
   * (e.g. "fnb-pdf", "standard-bank-pdf"). */
  id: string;
  label: string;
  matchesFile: (filename: string) => boolean;
  parse: (buffer: ArrayBuffer, filename: string, importBatch: string) => BankStatementParseResult | Promise<BankStatementParseResult>;
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

/** Populate with a real `BankStatementAdapter` per bank once example
 * PDF statements are supplied. Empty today, on purpose — see this file's
 * module docstring. */
export const PDF_ADAPTERS: BankStatementAdapter[] = [];

export function resolveBankStatementAdapter(filename: string): BankStatementAdapter | null {
  return (
    BANK_STATEMENT_ADAPTERS.find((adapter) => adapter.matchesFile(filename)) ??
    PDF_ADAPTERS.find((adapter) => adapter.matchesFile(filename)) ??
    null
  );
}

export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".ofx", ".qif"];
