/**
 * SD-3C — CSV and XLSX statements: a SECONDARY convenience path.
 *
 * Supplier statements arrive overwhelmingly as PDFs; this is for the
 * supplier who also sends a spreadsheet. It is deliberately NOT a separate
 * reader with its own rules: the grid is laid out as positioned cells and
 * read by exactly the same layout reader as a PDF (`readStatementLayout`) —
 * same column headings, same brought/carried-forward and totals handling,
 * same unread-value rules. One reader, one set of behaviours; the
 * spreadsheet is just another way of delivering the same page.
 *
 * Pure; no I/O. (XLSX workbook loading is in the service.)
 */

import { readStatementLayout, type LayoutPage, type LayoutToken } from "./layout";
import type { StatementExtraction } from "./types";

/** A spreadsheet cell: its text as shown, and — for XLSX — the typed value
 * the spreadsheet holds, which is used instead of re-reading the text. */
export type TabularCell = { text: string; number?: number | null; isoDate?: string | null };

const COLUMN_WIDTH = 100;
const CELL_WIDTH = 60;
const ROW_HEIGHT = 14;
const FONT = 10;

function cellText(cell: TabularCell): string {
  if (typeof cell.number === "number" && Number.isFinite(cell.number)) {
    // A spreadsheet number is exact: printed with a decimal point, no
    // thousands separator, so it can only be read one way.
    return cell.number.toFixed(2);
  }
  if (cell.isoDate) return cell.isoDate;
  return cell.text;
}

export function gridToLayoutPage(rows: TabularCell[][]): LayoutPage {
  const tokens: LayoutToken[] = [];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const text = cellText(cell).replace(/\s+/g, " ").trim();
      if (text === "") return;
      tokens.push({ text, x: c * COLUMN_WIDTH, y: (r + 1) * ROW_HEIGHT, width: CELL_WIDTH, height: FONT });
    });
  });
  return { pageNumber: 1, width: Math.max(1, ...rows.map((r) => r.length)) * COLUMN_WIDTH, height: (rows.length + 2) * ROW_HEIGHT, tokens };
}

export function readTabularStatement(rows: TabularCell[][]): StatementExtraction {
  const read = readStatementLayout([gridToLayoutPage(rows)]);
  return {
    ...read,
    method: "tabular",
    pageCount: null,
    // A spreadsheet has no letterhead: the "largest text" proposal means
    // nothing, so only an explicitly labelled supplier name is kept.
    header: { ...read.header, supplierName: labelledSupplier(rows) },
    lines: read.lines.map((l) => ({ ...l, pageNumber: null })),
  };
}

function labelledSupplier(rows: TabularCell[][]): string | null {
  for (const row of rows.slice(0, 15)) {
    for (let i = 0; i < row.length; i++) {
      const m = /^(supplier|supplier name|from|creditor)\s*:?\s*(.*)$/i.exec(row[i].text.trim());
      if (!m) continue;
      const value = (m[2] || row[i + 1]?.text || "").trim();
      if (value) return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// CSV text → grid
// ---------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 15).join("\n");
  let best = ",";
  let bestCount = -1;
  for (const candidate of [",", ";", "\t", "|"]) {
    let count = 0;
    let quoted = false;
    for (const ch of sample) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 CSV with the delimiter detected (South African exports often
 * use ";" because "," is their decimal mark). */
export function parseCsvGrid(text: string): TabularCell[][] {
  const delimiter = detectDelimiter(text);
  const rows: TabularCell[][] = [];
  let row: TabularCell[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push({ text: field });
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === "\r") continue;
    else if (ch === "\n") {
      endField();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.text.trim() !== ""));
}
