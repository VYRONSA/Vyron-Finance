/**
 * VYRON Standard Bank Import Template CSV parser — ported field-for-field
 * from `bank_import/bank_statement_parser.py`. VYRON FINANCE deliberately
 * supports exactly one bank import layout: users convert their own bank
 * exports into this template first, so the header match is strict and
 * position-sensitive rather than alias-based like the Bills parser.
 *
 * Standard Template columns, in this exact order:
 *   Date* | Reference | Description* | Beneficiary* | Debit* | Credit* |
 *   Balance | Bank Account | VAT | GL Account | Notes
 * (* = required per cell; all 11 columns must be present as headers, in
 * this exact order.)
 *
 * `parseBankStatementCsv` never throws for a bad row: anything that can't
 * be read is captured as an ImportExceptionRecord and the rest of the file
 * keeps processing. A header row that doesn't match the template rejects
 * the whole file as a single exception, rather than being guessed at —
 * that's the point of standardising on one layout. PDF/xlsx bank-specific
 * parsers from the reference app are out of scope for this module.
 */

import { cleanText, isBlankRow, normalizeHeader, parseAmount, parseDate, parseCsvText, round2 } from "./csv-utils";
import type { BankStatementParseResult, ImportExceptionRecord, ParsedBankTransaction } from "./types";

const STANDARD_HEADERS = [
  "Date", "Reference", "Description", "Beneficiary", "Debit", "Credit",
  "Balance", "Bank Account", "VAT", "GL Account", "Notes",
];
const NORMALIZED_STANDARD_HEADERS = STANDARD_HEADERS.map(normalizeHeader);

function matchesStandardTemplate(headers: string[]): boolean {
  if (headers.length !== STANDARD_HEADERS.length) return false;
  return headers.map(normalizeHeader).every((h, i) => h === NORMALIZED_STANDARD_HEADERS[i]);
}

function rowEqualsHeaders(rawRow: string[], headers: string[]): boolean {
  if (rawRow.length !== headers.length) return false;
  return rawRow.every((cell, index) => cleanText(cell) === headers[index]);
}

export function parseBankStatementCsv(fileText: string, filename: string, importBatch: string): BankStatementParseResult {
  const transactions: ParsedBankTransaction[] = [];
  const exceptions: ImportExceptionRecord[] = [];
  let rowsRead = 0;

  const rawRows = parseCsvText(fileText);

  const headerIndex = rawRows.findIndex((row) => !isBlankRow(row));
  if (headerIndex === -1) {
    return { transactions, exceptions, outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  const headers = rawRows[headerIndex].map(cleanText);
  if (!matchesStandardTemplate(headers)) {
    exceptions.push({
      sourceFilename: filename,
      rowNumber: headerIndex + 1,
      exceptionType: "Invalid Template",
      description:
        `File does not match the VYRON Standard Bank Import Template. ` +
        `Expected columns (in order): ${STANDARD_HEADERS.join(", ")}. Found: ${headers.join(", ")}`,
    });
    return { transactions, exceptions, outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  const dataRows = rawRows.slice(headerIndex + 1);

  for (let offset = 0; offset < dataRows.length; offset++) {
    const rawRow = dataRows[offset];
    const rowNumber = headerIndex + 2 + offset;

    if (isBlankRow(rawRow)) continue;
    if (rowEqualsHeaders(rawRow, headers)) continue;

    rowsRead++;
    let beneficiary = "";

    try {
      const cell = (index: number): string => (index < rawRow.length ? rawRow[index] : "");

      const dateRaw = cleanText(cell(0));
      const transactionDate = parseDate(dateRaw);
      if (transactionDate === null) {
        exceptions.push({
          sourceFilename: filename, rowNumber, exceptionType: "Invalid Date",
          description: `Invalid or missing transaction date: '${dateRaw}'`,
        });
        continue;
      }

      const reference = cleanText(cell(1));

      const description = cleanText(cell(2));
      if (!description) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Description", description: "Missing description" });
        continue;
      }

      beneficiary = cleanText(cell(3));
      if (!beneficiary) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Beneficiary", description: "Missing beneficiary", beneficiary });
        continue;
      }

      const debitRaw = cleanText(cell(4));
      const creditRaw = cleanText(cell(5));
      const debit = debitRaw ? parseAmount(debitRaw) : 0;
      const credit = creditRaw ? parseAmount(creditRaw) : 0;

      if (debitRaw && debit === null) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount", description: `Invalid Debit value: '${debitRaw}'`, beneficiary });
        continue;
      }
      if (creditRaw && credit === null) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount", description: `Invalid Credit value: '${creditRaw}'`, beneficiary });
        continue;
      }

      const debitAmount = debit ?? 0;
      const creditAmount = credit ?? 0;

      if (debitAmount > 0 && creditAmount > 0) {
        exceptions.push({
          sourceFilename: filename, rowNumber, exceptionType: "Ambiguous Debit/Credit",
          description: `Both Debit (${debitAmount.toFixed(2)}) and Credit (${creditAmount.toFixed(2)}) are populated — a row must be a payment or a receipt, not both`,
          beneficiary,
        });
        continue;
      }
      if (debitAmount === 0 && creditAmount === 0) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Debit/Credit Amount", description: "Neither Debit nor Credit is populated", beneficiary });
        continue;
      }

      const balance = parseAmount(cell(6));
      const bankAccount = cleanText(cell(7));
      const vat = parseAmount(cell(8));
      const glAccount = cleanText(cell(9));
      const notes = cleanText(cell(10));

      transactions.push({
        transactionDate,
        reference,
        description,
        beneficiary,
        debit: round2(debitAmount),
        credit: round2(creditAmount),
        balance: balance !== null ? round2(balance) : null,
        bankAccount,
        vat: vat !== null ? round2(vat) : null,
        glAccount,
        notes,
        sourceFilename: filename,
        importBatch,
        rowNumber,
      });
    } catch (exc) {
      exceptions.push({
        sourceFilename: filename, rowNumber, exceptionType: "Corrupt Row",
        description: `Corrupt row: ${exc instanceof Error ? exc.message : String(exc)}`, beneficiary,
      });
      continue;
    }
  }

  const outcome = {
    filename,
    rowsRead,
    rowsImported: transactions.length,
    rowsSkipped: exceptions.length,
  };

  return { transactions, exceptions, outcome };
}
