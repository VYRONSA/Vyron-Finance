/**
 * SD-1 — validating what a reviewer has corrected or entered by hand.
 *
 * `validateExtraction` judges an extraction. After a person corrects one
 * (or types one in from the original document), the same deterministic
 * checks must run again on the values that will actually be converted —
 * otherwise a capture is converted on a verdict about figures it no longer
 * has, or an Incomplete one can never be fixed.
 *
 * This builds that input. Pure; no I/O.
 *
 * Two facts about the DOCUMENT are not the reviewer's to change, so they
 * come from the immutable extraction snapshot when there is one:
 *  - which invoice numbers the page prints (the multi-invoice-file check),
 *    with the reviewer's corrected own number standing in for a misread one;
 *  - how many lines the page declares (the truncated-read check), which is
 *    compared against every line the reviewer kept, excluded or not, so
 *    excluding a line is never mistaken for a truncated read.
 */

import { normaliseInvoiceNumber } from "./validation";
import type { ExtractedDocumentType, ExtractedLine, ExtractionResult } from "./types";

/** What `persistExtraction` stores in `extraction_snapshot`. */
export type ExtractionSnapshot = {
  header: ExtractionResult["header"];
  lines: ExtractedLine[];
  invoiceNumbersSeen: string[];
  declaredLineCount: number | null;
  missingFields: string[];
  warnings: string[];
};

export type ReviewedHeader = {
  documentType: string | null;
  /** The confirmed supplier's name, else the name read from the document. */
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierRegistrationNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  orderReference: string | null;
  currencyCode: string | null;
  subtotal: number | null;
  discountTotal: number | null;
  vatAmount: number | null;
  total: number | null;
};

export type ReviewedLine = {
  description: string | null;
  supplierSku: string | null;
  quantity: number | null;
  uom: string | null;
  unitPrice: number | null;
  discount: number | null;
  vatRatePercent: number | null;
  vatAmount: number | null;
  lineTotal: number | null;
  isExcluded: boolean;
};

const DOCUMENT_TYPES: ReadonlySet<string> = new Set<ExtractedDocumentType>(["Invoice", "Credit Note", "Debit Note", "Other"]);

export function buildReviewedExtraction(header: ReviewedHeader, lines: ReviewedLine[], snapshot: ExtractionSnapshot | null): ExtractionResult {
  const included = lines.filter((l) => !l.isExcluded);

  const ownNumber = normaliseInvoiceNumber(header.invoiceNumber);
  let numbersSeen: string[];
  if (snapshot) {
    const misread = normaliseInvoiceNumber(snapshot.header.invoiceNumber);
    numbersSeen = snapshot.invoiceNumbersSeen.filter((n) => !(misread && normaliseInvoiceNumber(n) === misread && misread !== ownNumber));
    if (ownNumber && !numbersSeen.some((n) => normaliseInvoiceNumber(n) === ownNumber)) numbersSeen.push(header.invoiceNumber!.trim());
  } else {
    numbersSeen = ownNumber ? [header.invoiceNumber!.trim()] : [];
  }

  const declared = snapshot?.declaredLineCount ?? null;
  const declaredLineCount = declared !== null && lines.length < declared ? declared : null;

  return {
    header: {
      documentType: header.documentType && DOCUMENT_TYPES.has(header.documentType) ? (header.documentType as ExtractedDocumentType) : null,
      supplierName: header.supplierName,
      supplierVatNumber: header.supplierVatNumber,
      supplierRegistrationNumber: header.supplierRegistrationNumber,
      invoiceNumber: header.invoiceNumber,
      invoiceDate: header.invoiceDate,
      dueDate: header.dueDate,
      orderReference: header.orderReference,
      currencyCode: header.currencyCode,
      subtotal: header.subtotal,
      discountTotal: header.discountTotal,
      vatAmount: header.vatAmount,
      total: header.total,
      confidence: null,
    },
    lines: included.map((l) => ({
      description: l.description,
      supplierSku: l.supplierSku,
      quantity: l.quantity,
      uom: l.uom,
      packDescription: null,
      packQuantity: null,
      unitPrice: l.unitPrice,
      discount: l.discount,
      vatRatePercent: l.vatRatePercent,
      vatAmount: l.vatAmount,
      lineTotal: l.lineTotal,
      confidence: null,
    })),
    invoiceNumbersSeen: numbersSeen,
    missingFields: [],
    warnings: [],
    declaredLineCount,
  };
}

/** Parses a stored snapshot defensively: anything that is not the expected
 * shape is treated as "no snapshot" rather than trusted. */
export function readExtractionSnapshot(value: unknown): ExtractionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ExtractionSnapshot>;
  if (!v.header || typeof v.header !== "object" || !Array.isArray(v.lines) || !Array.isArray(v.invoiceNumbersSeen)) return null;
  return {
    header: v.header,
    lines: v.lines,
    invoiceNumbersSeen: v.invoiceNumbersSeen.filter((n): n is string => typeof n === "string"),
    declaredLineCount: typeof v.declaredLineCount === "number" ? v.declaredLineCount : null,
    missingFields: Array.isArray(v.missingFields) ? v.missingFields : [],
    warnings: Array.isArray(v.warnings) ? v.warnings : [],
  };
}
