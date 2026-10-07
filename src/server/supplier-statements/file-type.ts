/**
 * SD-3C — what kind of statement file this is, from its BYTES.
 *
 * Never from the declared MIME type (a browser's guess) and never from the
 * file name alone. PDF first; JPEG/PNG for scans; CSV/XLSX as secondary
 * formats. Anything else is refused before it is stored.
 */
import { detectInlineFileType } from "@/server/documents/inline-file-type";

export type StatementFileKind = "pdf" | "image" | "csv" | "xlsx";

function contains(bytes: Uint8Array, ascii: string, limit: number): boolean {
  const needle = Array.from(ascii, (c) => c.charCodeAt(0));
  const end = Math.min(bytes.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function detectStatementFileType(bytes: Uint8Array, filename: string): StatementFileKind | null {
  const inline = detectInlineFileType(bytes);
  if (inline === "application/pdf") return "pdf";
  if (inline === "image/jpeg" || inline === "image/png") return "image";

  // XLSX: a ZIP container holding a workbook part.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return contains(bytes, "xl/", 1024 * 1024) ? "xlsx" : null;
  }

  // CSV: text (no NUL bytes) with a .csv name and a delimiter.
  if (/\.(csv|txt)$/i.test(filename)) {
    const head = bytes.subarray(0, 8192);
    if (head.includes(0)) return null;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
    if (/[,;\t|]/.test(text)) return "csv";
  }
  return null;
}

export const STATEMENT_MIME: Record<StatementFileKind, string> = {
  pdf: "application/pdf",
  image: "image/*",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
