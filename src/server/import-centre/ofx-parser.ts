/**
 * OFX (Open Financial Exchange) bank statement parser. OFX is a real,
 * fully-specified standard (unlike a bank's own PDF layout), so — unlike
 * PDF — this can be built correctly right now without needing bank-
 * supplied samples. Extracts every `<STMTTRN>...</STMTTRN>` block via a
 * tag-per-line regex scan rather than a full SGML/XML parser: OFX files
 * in the wild are near-universally one-tag-per-line (the format predates
 * XML and most exporters never adopted the optional XML variant's closing
 * tags on every element), so this covers the format as banks actually
 * produce it.
 */

import { cleanText, round2 } from "./csv-utils";
import type { BankStatementParseResult, ImportExceptionRecord, ParsedBankTransaction } from "./types";

function extractTag(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return match ? cleanText(match[1]) : null;
}

function parseOfxDate(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\[.*$/, "").slice(0, 8);
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(digits);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

export function parseOfxStatement(fileText: string, filename: string, importBatch: string): BankStatementParseResult {
  const transactions: ParsedBankTransaction[] = [];
  const exceptions: ImportExceptionRecord[] = [];

  const acctMatch = /<ACCTID>([^<\r\n]*)/i.exec(fileText);
  const bankAccount = acctMatch ? cleanText(acctMatch[1]) : "";

  const blocks = fileText.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  if (blocks.length === 0) {
    exceptions.push({
      sourceFilename: filename,
      rowNumber: 1,
      exceptionType: "Invalid Template",
      description: "No <STMTTRN> transaction blocks found — this does not look like a valid OFX bank statement export.",
    });
    return { transactions, exceptions, outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  let rowNumber = 0;
  for (const block of blocks) {
    rowNumber++;
    const transactionDate = parseOfxDate(extractTag(block, "DTPOSTED"));
    if (!transactionDate) {
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Date", description: `Invalid or missing DTPOSTED in transaction ${rowNumber}` });
      continue;
    }

    const amountRaw = extractTag(block, "TRNAMT");
    const amount = amountRaw !== null ? Number(amountRaw) : NaN;
    if (Number.isNaN(amount) || amount === 0) {
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount", description: `Invalid or missing TRNAMT in transaction ${rowNumber}` });
      continue;
    }

    const beneficiary = extractTag(block, "NAME") ?? extractTag(block, "PAYEE") ?? "";
    if (!beneficiary) {
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Beneficiary", description: `Missing NAME/PAYEE in transaction ${rowNumber}` });
      continue;
    }

    const memo = extractTag(block, "MEMO") ?? "";
    const fitId = extractTag(block, "FITID") ?? "";

    transactions.push({
      transactionDate,
      reference: fitId,
      description: memo || beneficiary,
      beneficiary,
      // OFX convention: negative TRNAMT is money out (debit), positive is money in (credit).
      debit: amount < 0 ? round2(Math.abs(amount)) : 0,
      credit: amount > 0 ? round2(amount) : 0,
      balance: null,
      bankAccount,
      vat: null,
      glAccount: "",
      notes: "",
      sourceFilename: filename,
      importBatch,
      rowNumber,
    });
  }

  return {
    transactions,
    exceptions,
    outcome: { filename, rowsRead: blocks.length, rowsImported: transactions.length, rowsSkipped: exceptions.length },
  };
}
