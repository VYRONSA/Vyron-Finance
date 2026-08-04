/**
 * QIF (Quicken Interchange Format) bank statement parser — like OFX, a
 * real, fully-specified standard, buildable correctly without bank
 * samples. `!Type:Bank`/`!Type:Cash`/`!Type:CCard` headers, one record
 * per line-prefixed field block, `^` terminates each record.
 */

import { cleanText, parseAmount, parseDate, round2 } from "./csv-utils";
import type { BankStatementParseResult, ImportExceptionRecord, ParsedBankTransaction } from "./types";

export function parseQifStatement(fileText: string, filename: string, importBatch: string): BankStatementParseResult {
  const transactions: ParsedBankTransaction[] = [];
  const exceptions: ImportExceptionRecord[] = [];

  const lines = fileText.split(/\r?\n/);
  const headerLine = lines.find((l) => l.trim().startsWith("!Type:"));
  if (!headerLine) {
    exceptions.push({
      sourceFilename: filename,
      rowNumber: 1,
      exceptionType: "Invalid Template",
      description: "No '!Type:' header found — this does not look like a valid QIF file.",
    });
    return { transactions, exceptions, outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  let rowNumber = 0;
  let record: Record<string, string> = {};

  function flush() {
    if (Object.keys(record).length === 0) return;
    rowNumber++;

    const transactionDate = parseDate(record.D);
    if (!transactionDate) {
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Date", description: `Invalid or missing date ('D') in record ${rowNumber}` });
      record = {};
      return;
    }

    const amount = parseAmount(record.T ?? record.U);
    if (amount === null || amount === 0) {
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount", description: `Invalid or missing amount ('T') in record ${rowNumber}` });
      record = {};
      return;
    }

    const beneficiary = cleanText(record.P);
    if (!beneficiary) {
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Beneficiary", description: `Missing payee ('P') in record ${rowNumber}` });
      record = {};
      return;
    }

    transactions.push({
      transactionDate,
      reference: cleanText(record.N),
      description: cleanText(record.M) || beneficiary,
      beneficiary,
      // QIF convention: negative amount is money out (debit), positive is money in (credit).
      debit: amount < 0 ? round2(Math.abs(amount)) : 0,
      credit: amount > 0 ? round2(amount) : 0,
      balance: null,
      bankAccount: "",
      vat: null,
      glAccount: cleanText(record.L),
      notes: "",
      sourceFilename: filename,
      importBatch,
      rowNumber,
    });
    record = {};
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("!Type:")) continue;
    if (line.trim() === "^") {
      flush();
      continue;
    }
    const code = line[0];
    const value = line.slice(1);
    record[code] = value;
  }
  flush();

  return {
    transactions,
    exceptions,
    outcome: { filename, rowsRead: rowNumber, rowsImported: transactions.length, rowsSkipped: exceptions.length },
  };
}
