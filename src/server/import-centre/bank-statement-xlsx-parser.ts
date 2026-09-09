/**
 * Excel (.xlsx) counterpart to `bank-statement-parser.ts` — same VYRON
 * Standard Bank Import Template column layout and strict header match,
 * just read from a worksheet via `exceljs` (already a dependency, used
 * for export) instead of CSV text.
 */

import ExcelJS from "exceljs";
import { cleanText, normalizeHeader, parseAmount, parseDate, round2 } from "./csv-utils";
import { STANDARD_HEADERS } from "./bank-statement-parser";
import type { BankStatementParseResult, ImportExceptionRecord, ParsedBankTransaction } from "./types";

const NORMALIZED_STANDARD_HEADERS = STANDARD_HEADERS.map(normalizeHeader);

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return cleanText((value as { text: unknown }).text);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return cleanText(value);
}

export async function parseBankStatementXlsx(buffer: ArrayBuffer, filename: string, importBatch: string): Promise<BankStatementParseResult> {
  const transactions: ParsedBankTransaction[] = [];
  const exceptions: ImportExceptionRecord[] = [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    return { transactions, exceptions, outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  for (let col = 1; col <= STANDARD_HEADERS.length; col++) headers.push(cellText(headerRow.getCell(col)));

  if (headers.map(normalizeHeader).join("|") !== NORMALIZED_STANDARD_HEADERS.join("|")) {
    exceptions.push({
      sourceFilename: filename,
      rowNumber: 1,
      exceptionType: "Invalid Template",
      description:
        `File does not match the VYRON Standard Bank Import Template. Expected columns (in order): ${STANDARD_HEADERS.join(", ")}. Found: ${headers.join(", ")}. ` +
        `Download the Bank Transactions Import Template and use it as-is, or paste your data into it.`,
    });
    return { transactions, exceptions, outcome: { filename, rowsRead: 0, rowsImported: 0, rowsSkipped: 0 } };
  }

  let rowsRead = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cell = (col: number) => cellText(row.getCell(col));
    if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((c) => !cell(c))) continue;

    rowsRead++;
    let beneficiary = "";
    try {
      const dateRaw = cell(1);
      const transactionDate = parseDate(dateRaw);
      if (!transactionDate) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Date", description: `Invalid or missing transaction date: '${dateRaw}'` });
        continue;
      }

      const reference = cell(2);
      const description = cell(3);
      if (!description) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Description", description: "Missing description" });
        continue;
      }

      beneficiary = cell(4);
      if (!beneficiary) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Beneficiary", description: "Missing beneficiary", beneficiary });
        continue;
      }

      const debitRaw = cell(5);
      const creditRaw = cell(6);
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
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Ambiguous Debit/Credit", description: `Both Debit (${debitAmount.toFixed(2)}) and Credit (${creditAmount.toFixed(2)}) are populated`, beneficiary });
        continue;
      }
      if (debitAmount === 0 && creditAmount === 0) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Missing Debit/Credit Amount", description: "Neither Debit nor Credit is populated", beneficiary });
        continue;
      }

      // Phase 32A — same guard as `bank-statement-parser.ts`'s CSV path:
      // a non-blank Balance/VAT that fails to parse must reject the row,
      // never silently vanish as if the column were empty.
      const balanceRaw = cell(7);
      const balance = balanceRaw ? parseAmount(balanceRaw) : null;
      if (balanceRaw && balance === null) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount", description: `Invalid Balance value: '${balanceRaw}'`, beneficiary });
        continue;
      }
      const bankAccount = cell(8);
      const vatRaw = cell(9);
      const vat = vatRaw ? parseAmount(vatRaw) : null;
      if (vatRaw && vat === null) {
        exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Invalid Amount", description: `Invalid VAT value: '${vatRaw}'`, beneficiary });
        continue;
      }
      const glAccount = cell(10);
      const notes = cell(11);

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
      exceptions.push({ sourceFilename: filename, rowNumber, exceptionType: "Corrupt Row", description: `Corrupt row: ${exc instanceof Error ? exc.message : String(exc)}`, beneficiary });
    }
  }

  return { transactions, exceptions, outcome: { filename, rowsRead, rowsImported: transactions.length, rowsSkipped: exceptions.length } };
}
