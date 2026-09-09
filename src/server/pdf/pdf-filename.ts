/**
 * Phase 24A — pure filename construction. Uses ONLY real, already-issued
 * identifiers (`invoice.invoiceNumber`, the customer's real name) — never
 * a fabricated numbering scheme. Sanitizes for filesystem/HTTP-header
 * safety (a `Content-Disposition` filename must not contain control
 * characters, quotes, or path separators).
 */

import type { SalesInvoice } from "@/server/sales/types";

function sanitizeFilenameSegment(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics, same convention as identifier-engine.ts's slugifyCompanyName
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document"
  );
}

export function invoicePdfFilename(invoice: SalesInvoice): string {
  return `${sanitizeFilenameSegment(invoice.invoiceNumber)}.pdf`;
}

/** `asOfDate` should be the SAME real date the statement document itself
 * displays as its "Statement Date" (`StatementDocument`'s own
 * `new Date().toISOString().slice(0, 10)`) — passed in rather than
 * computed twice, so the filename and the document body can never
 * silently disagree about what date the statement is "as of." */
export function statementPdfFilename(customerName: string, asOfDate: string): string {
  return `STATEMENT-${sanitizeFilenameSegment(customerName)}-${sanitizeFilenameSegment(asOfDate)}.pdf`;
}
