/**
 * Report exports — CSV and Excel from the one `ReportResult` shape, so
 * every report exports identically. Same Excel conventions as the
 * existing `trial-balance-export.ts` / `transaction-export.ts` (bold
 * header, currency number format, bold totals), extended with the report
 * header block, section titles, indentation, and the reconciliation
 * checks and notices on their own sheet so an exported report carries
 * the same evidence as the on-screen one.
 */

import ExcelJS from "exceljs";
import type { ReportCompany } from "./source";
import type { ReportCell, ReportColumn, ReportResult, ReportRow } from "./types";

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cellText(value: ReportCell, column: ReportColumn): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return column.kind === "money" ? value.toFixed(2) : String(value);
  return value;
}

function labelForRow(row: ReportRow, firstKey: string): ReportRow {
  if (!row.level) return row;
  const first = row.cells[firstKey];
  return typeof first === "string" ? { ...row, cells: { ...row.cells, [firstKey]: `${"  ".repeat(row.level)}${first}` } } : row;
}

export function reportToCsv(result: ReportResult, company: ReportCompany): string {
  const lines: string[] = [company.name, result.title, result.subtitle, `Generated ${result.generatedAt.slice(0, 16).replace("T", " ")} UTC`, ""].map(csvField);
  for (const s of result.sections) {
    if (s.title) lines.push(csvField(s.title));
    lines.push(s.columns.map((c) => csvField(c.label)).join(","));
    for (const raw of s.rows) {
      const r = labelForRow(raw, s.columns[0]?.key ?? "");
      lines.push(s.columns.map((c) => csvField(cellText(r.cells[c.key] ?? null, c))).join(","));
    }
    lines.push("");
  }
  if (result.checks.length) {
    lines.push("Reconciliation checks");
    lines.push(["Check", "Expected", "Actual", "Difference", "Result"].join(","));
    for (const c of result.checks) lines.push([csvField(c.label), c.expected.toFixed(2), c.actual.toFixed(2), c.difference.toFixed(2), c.passed ? "Passed" : "FAILED"].join(","));
    lines.push("");
  }
  for (const n of result.notices) lines.push(csvField(`Note: ${n}`));
  return lines.join("\r\n");
}

const CURRENCY_FORMAT = "#,##0.00;[Red]-#,##0.00";

export async function reportToWorkbook(result: ReportResult, company: ReportCompany): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VYRON Finance";
  workbook.created = new Date(result.generatedAt);
  const sheet = workbook.addWorksheet(result.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const width = Math.max(1, ...result.sections.map((s) => s.columns.length));

  sheet.addRow([company.name]).font = { bold: true, size: 14 };
  sheet.addRow([result.title]).font = { bold: true, size: 12 };
  sheet.addRow([result.subtitle]);
  sheet.addRow([`Generated ${result.generatedAt.slice(0, 16).replace("T", " ")} UTC`]).font = { italic: true, color: { argb: "FF666666" } };
  sheet.addRow([]);

  const widths = new Array<number>(width).fill(12);
  for (const s of result.sections) {
    if (s.title) sheet.addRow([s.title]).font = { bold: true, size: 11 };
    const header = sheet.addRow(s.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.border = { bottom: { style: "thin" } };
    });
    for (const r of s.rows) {
      const values = s.columns.map((c) => {
        const v = r.cells[c.key];
        return v === null || v === undefined ? null : v;
      });
      const added = sheet.addRow(values);
      s.columns.forEach((c, i) => {
        const cell = added.getCell(i + 1);
        if (c.kind === "money") cell.numFmt = CURRENCY_FORMAT;
        if (c.kind === "percent" && typeof cell.value === "number") cell.numFmt = '0.00"%"';
        const text = values[i] === null ? "" : String(values[i]);
        widths[i] = Math.min(60, Math.max(widths[i], text.length + 2, c.label.length + 2));
      });
      if (r.level) added.getCell(1).alignment = { indent: r.level * 2 };
      if (r.kind === "group") added.font = { bold: true, color: { argb: "FF444444" } };
      if (r.kind === "subtotal") added.font = { bold: true };
      if (r.kind === "total") {
        added.font = { bold: true };
        added.eachCell((cell) => {
          cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
        });
      }
    }
    if (s.rows.length === 0 && s.emptyMessage) sheet.addRow([s.emptyMessage]).font = { italic: true };
    sheet.addRow([]);
  }
  sheet.columns.forEach((column, i) => {
    column.width = widths[i] ?? 12;
  });

  if (result.checks.length || result.notices.length) {
    const evidence = workbook.addWorksheet("Checks & Notes");
    evidence.addRow(["Check", "Expected", "Actual", "Difference", "Result"]).font = { bold: true };
    for (const c of result.checks) {
      const r = evidence.addRow([c.label, c.expected, c.actual, c.difference, c.passed ? "Passed" : "FAILED"]);
      [2, 3, 4].forEach((i) => (r.getCell(i).numFmt = CURRENCY_FORMAT));
      if (!c.passed) r.getCell(5).font = { bold: true, color: { argb: "FFC00000" } };
    }
    evidence.addRow([]);
    for (const n of result.notices) evidence.addRow([n]);
    evidence.getColumn(1).width = 80;
    [2, 3, 4, 5].forEach((i) => (evidence.getColumn(i).width = 16));
  }
  return workbook;
}

export function reportFilename(result: ReportResult, company: ReportCompany, extension: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(company.name) || "company"}-${result.reportId}-${result.generatedAt.slice(0, 10)}.${extension}`;
}
