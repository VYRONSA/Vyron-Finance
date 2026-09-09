/**
 * CSV/Excel export for the Trial Balance — same styling convention as
 * `accounting/transaction-export.ts` (bold header row, frozen header,
 * autofilter, a bold TOTAL row, autosized columns).
 */

import ExcelJS from "exceljs";
import type { TrialBalance } from "./types";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildTrialBalanceCsv(trialBalance: TrialBalance): string {
  const lines = [["Account Code", "Description", "Type", "Debit", "Credit"].map(csvField).join(",")];
  for (const r of trialBalance.rows) {
    lines.push([r.accountCode, r.description, r.accountType, r.debitBalance.toFixed(2), r.creditBalance.toFixed(2)].map(csvField).join(","));
  }
  lines.push(["", "TOTAL", "", trialBalance.totalDebit.toFixed(2), trialBalance.totalCredit.toFixed(2)].map(csvField).join(","));
  return lines.join("\r\n");
}

const CURRENCY_FORMAT = "#,##0.00";

export async function buildTrialBalanceWorkbook(trialBalance: TrialBalance): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Trial Balance");

  sheet.columns = [
    { header: "Account Code", key: "code", width: 14 },
    { header: "Description", key: "description", width: 32 },
    { header: "Type", key: "type", width: 18 },
    { header: "Debit", key: "debit", width: 16 },
    { header: "Credit", key: "credit", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of trialBalance.rows) {
    const row = sheet.addRow({ code: r.accountCode, description: r.description, type: r.accountType, debit: r.debitBalance, credit: r.creditBalance });
    row.getCell("debit").numFmt = CURRENCY_FORMAT;
    row.getCell("credit").numFmt = CURRENCY_FORMAT;
  }

  const totalRow = sheet.addRow({ description: "TOTAL", debit: trialBalance.totalDebit, credit: trialBalance.totalCredit });
  totalRow.font = { bold: true };
  totalRow.getCell("debit").numFmt = CURRENCY_FORMAT;
  totalRow.getCell("credit").numFmt = CURRENCY_FORMAT;

  sheet.autoFilter = "A1:E1";

  return workbook;
}
