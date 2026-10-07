/**
 * SD-2 — the review screen's own logic, kept pure so it is tested without a
 * browser: what still stops approval, what the lines add up to, and exactly
 * which fields a reviewer changed.
 *
 * None of this is authoritative. The server re-checks every one of these
 * (`assessConversion`, `validateExtraction`, the 0111/0112 guard); this
 * only lets the screen explain itself before a request is made.
 */
import { isCreditNote } from "./capture-stages";

export type HeaderValues = {
  documentType: string | null;
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

export const HEADER_FIELDS: (keyof HeaderValues)[] = [
  "documentType", "invoiceNumber", "invoiceDate", "dueDate", "orderReference",
  "currencyCode", "subtotal", "discountTotal", "vatAmount", "total",
];

export type LineValues = {
  lineOrder: number | null; // null = a line the reviewer is adding
  description: string;
  supplierSku: string | null;
  quantity: number | null;
  uom: string | null;
  unitPrice: number | null;
  discount: number | null;
  vatRatePercent: number | null;
  vatAmount: number | null;
  lineTotal: number | null;
  glAccount: string | null; // confirmed, else suggested
  vatCode: string | null;
  isExcluded: boolean;
  remove?: boolean;
};

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    return Math.abs(Number(a) - Number(b)) < 0.0005;
  }
  return (a ?? null) === (b ?? null);
}

/** Only the header fields that actually changed, ready for `correct-header`. */
export function headerChanges(before: HeaderValues, after: HeaderValues): Partial<HeaderValues> {
  const changed: Partial<HeaderValues> = {};
  for (const field of HEADER_FIELDS) {
    if (!same(before[field], after[field])) (changed as Record<string, unknown>)[field] = after[field];
  }
  return changed;
}

type LineCorrection = { lineOrder: number } & Partial<Omit<LineValues, "lineOrder" | "remove">>;
type NewLine = Partial<Omit<LineValues, "lineOrder" | "remove" | "isExcluded">>;

const LINE_FIELDS: (keyof Omit<LineValues, "lineOrder" | "remove">)[] = [
  "description", "supplierSku", "quantity", "uom", "unitPrice", "discount",
  "vatRatePercent", "vatAmount", "lineTotal", "glAccount", "vatCode", "isExcluded",
];

/** Corrections, additions and removals, ready for `correct-lines`. Only
 * fields that changed are sent, so an untouched suggestion is never turned
 * into a "confirmation" the reviewer did not make. */
export function lineChanges(before: LineValues[], after: LineValues[]): { lines: LineCorrection[]; add: NewLine[]; remove: number[] } {
  const original = new Map(before.filter((l) => l.lineOrder !== null).map((l) => [l.lineOrder as number, l]));
  const lines: LineCorrection[] = [];
  const add: NewLine[] = [];
  const remove: number[] = [];
  for (const line of after) {
    if (line.lineOrder === null) {
      if (line.remove) continue;
      const { description, supplierSku, quantity, uom, unitPrice, discount, vatRatePercent, vatAmount, lineTotal, glAccount, vatCode } = line;
      add.push({ description, supplierSku, quantity, uom, unitPrice, discount, vatRatePercent, vatAmount, lineTotal, glAccount, vatCode });
      continue;
    }
    if (line.remove) {
      remove.push(line.lineOrder);
      continue;
    }
    const prior = original.get(line.lineOrder);
    if (!prior) continue;
    const correction: LineCorrection = { lineOrder: line.lineOrder };
    for (const field of LINE_FIELDS) {
      if (!same(prior[field], line[field])) (correction as Record<string, unknown>)[field] = line[field];
    }
    if (Object.keys(correction).length > 1) lines.push(correction);
  }
  return { lines, add, remove };
}

/** A line's net, VAT and total as the purchase-bill engine would compute
 * them (quantity × unit price − discount, then the VAT code's rate), as
 * magnitudes — a credit note's sign is its document type. */
export function lineAmounts(line: Pick<LineValues, "quantity" | "unitPrice" | "discount" | "vatCode" | "vatRatePercent">, ratesByCode: Map<string, number>) {
  if (line.quantity === null || line.unitPrice === null) return null;
  const net = Math.abs(line.quantity * line.unitPrice) - Math.abs(line.discount ?? 0);
  const rate = (line.vatCode ? ratesByCode.get(line.vatCode) : undefined) ?? line.vatRatePercent ?? 0;
  const vat = Math.round(net * rate) / 100;
  return { net: Math.round(net * 100) / 100, vat, total: Math.round((net + vat) * 100) / 100 };
}

export function linesTotals(lines: LineValues[], ratesByCode: Map<string, number>) {
  let net = 0;
  let vat = 0;
  let complete = true;
  for (const line of lines) {
    if (line.isExcluded || line.remove) continue;
    const amounts = lineAmounts(line, ratesByCode);
    if (!amounts) {
      complete = false;
      continue;
    }
    net += amounts.net;
    vat += amounts.vat;
  }
  net = Math.round(net * 100) / 100;
  vat = Math.round(vat * 100) / 100;
  return { net, vat, total: Math.round((net + vat) * 100) / 100, complete };
}

export type BlockerInput = {
  status: string;
  documentType: string | null;
  supplierId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  validationStatus: string;
  duplicateStatus: string;
  duplicateReason: string;
  lines: Pick<LineValues, "description" | "quantity" | "unitPrice" | "glAccount" | "vatCode" | "isExcluded">[];
};

/** Everything that still stops approval, in plain words. Empty = the server
 * will be asked (it may still refuse, e.g. on an approval limit or a
 * foreign currency). */
export function conversionBlockers(input: BlockerInput): string[] {
  const blockers: string[] = [];
  if (input.status !== "NeedsReview") blockers.push("Only a document that is in review can be approved.");
  if (input.duplicateStatus === "Blocked") blockers.push(input.duplicateReason || "This document has already been captured.");
  if (input.validationStatus === "Incomplete") blockers.push("The document could not be read reliably. Correct the figures against the original, then validate again.");
  if (input.validationStatus === "Pending") blockers.push("The corrected document has not been validated yet. Validate it again before approving.");
  const type = (input.documentType ?? "").trim().toLowerCase();
  if (type && type !== "invoice" && !isCreditNote(input.documentType)) {
    blockers.push(`A supplier ${type} cannot be captured yet. Enter it by hand in Purchasing so it is booked with the right sign.`);
  }
  if (input.supplierId === null) blockers.push("Confirm which supplier this is from.");
  if (!input.invoiceNumber?.trim()) blockers.push("Enter the document number.");
  if (!input.invoiceDate) blockers.push("Enter the document date.");
  const included = input.lines.filter((l) => !l.isExcluded);
  if (included.length === 0) blockers.push("Include at least one line.");
  included.forEach((line, i) => {
    const name = line.description?.trim() ? `“${line.description.trim()}”` : `Line ${i + 1}`;
    if (!line.glAccount?.trim()) blockers.push(`${name} needs a GL account.`);
    if (!line.vatCode?.trim()) blockers.push(`${name} needs a VAT code.`);
    if (line.quantity === null || line.quantity === 0 || line.unitPrice === null) blockers.push(`${name} needs a quantity and a unit price.`);
  });
  return blockers;
}

const EVENT_LABELS: Record<string, string> = {
  Uploaded: "Uploaded",
  Queued: "Received and queued",
  ExtractionStarted: "Reading started",
  ExtractionSucceeded: "Read",
  ExtractionFailed: "Could not be read",
  ValidationEvaluated: "Checked",
  SupplierResolved: "Supplier matched",
  DuplicateEvaluated: "Duplicate check",
  FieldCorrected: "Corrected by reviewer",
  SupplierCreated: "Supplier created",
  ConvertedToBill: "Approved — draft created",
  Cancelled: "Rejected",
  Requeued: "Queued again",
  ManualEntryStarted: "Entry by hand started",
  SubmittedForReview: "Submitted for review",
};

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

/** A short, value-free summary of an audit event's detail. */
export function eventSummary(eventType: string, detail: Record<string, unknown>): string | null {
  if (eventType === "ValidationEvaluated" && typeof detail.status === "string") return `Result: ${detail.status}`;
  if (eventType === "DuplicateEvaluated" && typeof detail.status === "string") return `Result: ${detail.status}`;
  if (eventType === "FieldCorrected") {
    if (detail.learningFailed) return "A learned GL mapping could not be saved";
    const fields = Array.isArray(detail.fields) ? detail.fields.length : 0;
    const lines = Array.isArray(detail.lines) ? detail.lines.length : 0;
    const added = Number(detail.added ?? 0);
    const removed = Array.isArray(detail.removed) ? detail.removed.length : 0;
    const parts = [
      fields ? `${fields} field${fields === 1 ? "" : "s"}` : null,
      lines ? `${lines} line${lines === 1 ? "" : "s"} corrected` : null,
      added ? `${added} added` : null,
      removed ? `${removed} removed` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (eventType === "ConvertedToBill" && detail.billId !== undefined) {
    return `${detail.documentType === "Credit Note" ? "Credit note" : "Bill"} #${String(detail.billId)}`;
  }
  return null;
}
