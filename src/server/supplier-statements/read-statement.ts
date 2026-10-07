/**
 * SD-3C — read a stored statement file into a `StatementExtraction`, or say
 * plainly why it cannot be read automatically.
 *
 * Called from the ASYNCHRONOUS processing step (never inside the upload
 * request) and by the certification corpus test, so the corpus certifies
 * exactly the production path.
 *
 *   text PDF            → layout reader (PRIMARY)
 *   PDF, some pages scanned → layout reader for the text pages; the scanned
 *                         pages are named for manual entry
 *   scanned PDF / image → manual entry: there is no OCR in SD-3C and live AI
 *                         is off. Provider-agnostic: an OCR/vision provider
 *                         added later produces the same StatementExtraction.
 *   encrypted / corrupt / over the page limit → failed, with the reason
 *   CSV / XLSX          → the same layout reader over the grid (secondary)
 */
import ExcelJS from "exceljs";
import { extractPdfLayout, PdfExtractionError, PdfPageLimitError } from "@/server/import-centre/pdf-text-extraction";
import { readStatementLayout } from "./layout";
import { parseCsvGrid, readTabularStatement, type TabularCell } from "./tabular";
import type { StatementFileKind } from "./file-type";
import type { StatementExtraction, StatementSourceType } from "./types";

export const MAX_STATEMENT_PAGES = 60;
const MAX_GRID_ROWS = 5000;
const MAX_GRID_COLUMNS = 40;

export type StatementReadOutcome =
  | { kind: "extracted"; sourceType: Extract<StatementSourceType, "pdf-text" | "pdf-mixed" | "csv" | "xlsx">; extraction: StatementExtraction }
  | { kind: "manual-entry"; sourceType: Extract<StatementSourceType, "pdf-scanned" | "image">; pageCount: number | null; reason: string }
  | { kind: "failed"; sourceType: StatementSourceType; category: "encrypted" | "corrupted" | "too-many-pages" | "unreadable"; reason: string };

const NO_OCR =
  "This statement is a scanned image, so it has no text to read. Enter its lines by hand from the original (automatic reading of scanned statements is not switched on).";

export async function readStatementFile(bytes: Uint8Array, kind: StatementFileKind): Promise<StatementReadOutcome> {
  if (kind === "image") return { kind: "manual-entry", sourceType: "image", pageCount: 1, reason: NO_OCR };

  if (kind === "pdf") {
    let pages;
    try {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      pages = await extractPdfLayout(buffer, { maxPages: MAX_STATEMENT_PAGES });
    } catch (error) {
      if (error instanceof PdfPageLimitError) {
        return { kind: "failed", sourceType: "pdf", category: "too-many-pages", reason: `${error.message} Split it, or enter it by hand.` };
      }
      if (error instanceof PdfExtractionError) {
        return {
          kind: "failed",
          sourceType: "pdf",
          category: error.reason === "encrypted" ? "encrypted" : "corrupted",
          reason: error.message,
        };
      }
      throw error;
    }
    const textPages = pages.filter((p) => p.hasText);
    if (textPages.length === 0) return { kind: "manual-entry", sourceType: "pdf-scanned", pageCount: pages.length, reason: NO_OCR };
    const imageOnly = pages.filter((p) => !p.hasText).map((p) => p.pageNumber);
    const extraction = readStatementLayout(textPages, { imageOnlyPages: imageOnly });
    return { kind: "extracted", sourceType: imageOnly.length > 0 ? "pdf-mixed" : "pdf-text", extraction: { ...extraction, pageCount: pages.length } };
  }

  if (kind === "csv") {
    const text = decodeText(bytes);
    const grid = parseCsvGrid(text).slice(0, MAX_GRID_ROWS).map((r) => r.slice(0, MAX_GRID_COLUMNS));
    if (grid.length === 0) return { kind: "failed", sourceType: "csv", category: "unreadable", reason: "This CSV file is empty." };
    return { kind: "extracted", sourceType: "csv", extraction: readTabularStatement(grid) };
  }

  let grid: TabularCell[][];
  try {
    grid = await readXlsxGrid(bytes);
  } catch {
    return { kind: "failed", sourceType: "xlsx", category: "corrupted", reason: "This spreadsheet could not be opened. Save it again as .xlsx, or upload the PDF statement." };
  }
  if (grid.length === 0) return { kind: "failed", sourceType: "xlsx", category: "unreadable", reason: "This spreadsheet is empty." };
  return { kind: "extracted", sourceType: "xlsx", extraction: readTabularStatement(grid) };
}

function decodeText(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The first worksheet as cells, keeping numbers and dates TYPED so they are
 * never re-read from text. */
export async function readXlsxGrid(bytes: Uint8Array): Promise<TabularCell[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: TabularCell[][] = [];
  const last = Math.min(sheet.rowCount, MAX_GRID_ROWS);
  for (let r = 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const cells: TabularCell[] = [];
    const width = Math.min(row.cellCount, MAX_GRID_COLUMNS);
    for (let c = 1; c <= width; c++) cells.push(xlsxCell(row.getCell(c)));
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => c.text.trim() !== "" || c.number !== undefined || c.isoDate));
}

function xlsxCell(cell: ExcelJS.Cell): TabularCell {
  let value: unknown = cell.value;
  if (value && typeof value === "object" && "result" in (value as object)) value = (value as { result: unknown }).result;
  if (value === null || value === undefined) return { text: "" };
  if (typeof value === "number") return { text: String(value), number: value };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), isoDate: value.toISOString().slice(0, 10) };
  if (typeof value === "object" && "richText" in (value as object)) {
    return { text: ((value as { richText: { text: string }[] }).richText ?? []).map((p) => p.text).join("") };
  }
  if (typeof value === "object" && "text" in (value as object)) return { text: String((value as { text: unknown }).text ?? "") };
  return { text: String(value) };
}
