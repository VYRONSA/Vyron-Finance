/**
 * CSV/Excel export for Transaction Explorer — styling mirrors the
 * reference's `accounting_engine/transaction_explorer_export.py`
 * (`export_transactions_excel`/`export_transactions_csv`): bold header
 * row, frozen header, autofilter, a bold TOTAL row, autosized columns.
 * Row-shaping (`transactionsToExportRows`) is pure and unit-tested
 * independently of exceljs/Supabase.
 */

import ExcelJS from "exceljs";
import type { BankTransactionRecord } from "./types";

export type ExportRow = {
  date: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number | null;
  bankAccount: string;
  supplier: string;
  glAccount: string;
  vatTreatment: string;
  matchingStatus: string;
  confidence: number | null;
  recoveryStatus: string;
  rulesApplied: string;
  reviewStatus: string;
  journalNumber: string;
};

export const EXPORT_COLUMNS: { key: keyof ExportRow; header: string; width: number; kind: "text" | "date" | "currency" | "percent" }[] = [
  { key: "date", header: "Date", width: 12, kind: "date" },
  { key: "description", header: "Description", width: 32, kind: "text" },
  { key: "reference", header: "Reference", width: 16, kind: "text" },
  { key: "debit", header: "Debit", width: 14, kind: "currency" },
  { key: "credit", header: "Credit", width: 14, kind: "currency" },
  { key: "balance", header: "Balance", width: 14, kind: "currency" },
  { key: "bankAccount", header: "Bank Account", width: 16, kind: "text" },
  { key: "supplier", header: "Supplier", width: 24, kind: "text" },
  { key: "glAccount", header: "GL Account", width: 16, kind: "text" },
  { key: "vatTreatment", header: "VAT Treatment", width: 16, kind: "text" },
  { key: "matchingStatus", header: "Matching Status", width: 16, kind: "text" },
  { key: "confidence", header: "Confidence", width: 12, kind: "percent" },
  { key: "recoveryStatus", header: "Recovery Status", width: 32, kind: "text" },
  { key: "rulesApplied", header: "Rule(s) Applied", width: 28, kind: "text" },
  { key: "reviewStatus", header: "Review Status", width: 14, kind: "text" },
  { key: "journalNumber", header: "Journal", width: 14, kind: "text" },
];

export function transactionsToExportRows(transactions: BankTransactionRecord[]): ExportRow[] {
  return transactions.map((t) => ({
    date: t.transactionDate ?? "",
    description: t.description,
    reference: t.reference,
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
    bankAccount: t.bankAccount,
    supplier: t.matchedSupplierName ?? t.beneficiary,
    glAccount: t.suggestedGlAccount ?? "",
    vatTreatment: t.suggestedVatCode ?? "",
    matchingStatus: t.allocationStatus,
    confidence: t.confidenceScore,
    recoveryStatus: t.requiredAction ?? "",
    rulesApplied: t.rulesTriggered.join("; "),
    reviewStatus: t.reviewStatus ?? "",
    journalNumber: t.journalId !== null ? `#${t.journalId}` : "",
  }));
}

function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Flat CSV (no grouping) with a trailing bold-equivalent TOTAL row —
 * mirrors the reference's flat export layout. */
export function buildTransactionsCsv(transactions: BankTransactionRecord[]): string {
  const rows = transactionsToExportRows(transactions);
  const lines = [EXPORT_COLUMNS.map((c) => csvField(c.header)).join(",")];

  for (const row of rows) {
    lines.push(
      EXPORT_COLUMNS.map((c) => {
        const value = row[c.key];
        if (c.kind === "currency" && typeof value === "number") return csvField(value.toFixed(2));
        if (c.kind === "percent" && typeof value === "number") return csvField(value.toFixed(2));
        return csvField(value);
      }).join(","),
    );
  }

  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const totalRow = EXPORT_COLUMNS.map((c) => {
    if (c.key === "description") return csvField("TOTAL");
    if (c.key === "debit") return csvField(totalDebit.toFixed(2));
    if (c.key === "credit") return csvField(totalCredit.toFixed(2));
    return "";
  });
  lines.push(totalRow.join(","));

  return lines.join("\r\n");
}

const CURRENCY_FORMAT = "#,##0.00";
const DATE_FORMAT = "yyyy-mm-dd";

export async function buildTransactionsWorkbook(transactions: BankTransactionRecord[]): Promise<ExcelJS.Workbook> {
  const rows = transactionsToExportRows(transactions);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Transactions");

  sheet.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    const excelRow = sheet.addRow(row);
    for (const col of EXPORT_COLUMNS) {
      if (col.kind === "currency" || col.kind === "date") {
        const cell = excelRow.getCell(col.key);
        cell.numFmt = col.kind === "currency" ? CURRENCY_FORMAT : DATE_FORMAT;
      }
    }
  }

  const totalDebit = Math.round(rows.reduce((sum, r) => sum + r.debit, 0) * 100) / 100;
  const totalCredit = Math.round(rows.reduce((sum, r) => sum + r.credit, 0) * 100) / 100;
  const totalRow = sheet.addRow({ description: "TOTAL", debit: totalDebit, credit: totalCredit });
  totalRow.font = { bold: true };
  totalRow.getCell("debit").numFmt = CURRENCY_FORMAT;
  totalRow.getCell("credit").numFmt = CURRENCY_FORMAT;

  const lastColumnLetter = sheet.getColumn(EXPORT_COLUMNS.length).letter;
  sheet.autoFilter = `A1:${lastColumnLetter}1`;

  return workbook;
}
