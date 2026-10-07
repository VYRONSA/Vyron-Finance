/**
 * Phase 5L — deterministic duplicate protection.
 *
 * VYRON COST built a careful four-layer detector, computed an `action` of
 * `"block"`, and then never read it: approval did not consult duplicates at
 * all, and its approval-time check raised its alert AFTER the cost writes
 * had already happened. A duplicate was approved, costed, and then flagged.
 *
 * Here the verdict is BINDING. `assessDuplicate` returns a `Blocked`
 * decision and `convertCaptureToBill` refuses on it — there is no `force`
 * parameter anywhere in this feature for it to be overridden by.
 *
 * Note what this layers on top of: Finance ALREADY enforces
 * `unique (company_id, supplier_name, invoice_number)` on
 * `ae_imported_bills` at the database. That constraint is the last line and
 * cannot be talked out of. This module exists so the reviewer is told
 * clearly and early, instead of meeting a unique-violation at conversion.
 *
 * The model's own opinion about duplication is not an input here and never
 * will be: it sees one document and has no access to the tenant's history.
 */

import { normaliseInvoiceNumber } from "./validation";
import type { DuplicateStatus } from "./types";

/** Money equality to half a cent. */
function sameMoney(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= 0.005;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(Math.round((left - right) / 86_400_000));
}

/** How close two same-value invoices from one supplier must be dated
 * before it is worth a human's attention. */
export const DATE_WINDOW_DAYS = 7;

export type DuplicateCandidateCapture = {
  captureId: number;
  supplierId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number | null;
  contentSha256: string | null;
  status: string;
};

export type DuplicateCandidateBill = {
  billId: number;
  supplierId: number;
  invoiceNumber: string;
  invoiceDate: string | null;
  total: number | null;
};

export type DuplicateSubject = {
  captureId: number;
  supplierId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number | null;
  contentSha256: string | null;
};

export type DuplicateDecision = {
  status: DuplicateStatus;
  /** The layer that decided, for the audit trail. */
  layer: "file-hash" | "supplier-invoice-number" | "supplier-total-window" | "none";
  reason: string;
  ofCaptureId: number | null;
  ofBillId: number | null;
};

const NO_DUPLICATE: DuplicateDecision = {
  status: "None",
  layer: "none",
  reason: "",
  ofCaptureId: null,
  ofBillId: null,
};

/**
 * Layers, strongest first. The first that fires decides.
 *
 *   1 file hash                  byte-identical file already captured.
 *                                Supplier-independent — the same document,
 *                                however it was described.               BLOCK
 *   2 supplier + invoice number  one serial number, one document.        BLOCK
 *   3 supplier + total + window  same supplier, same money, days apart.  POSSIBLE
 *   4 same file as a REJECTED capture                                    POSSIBLE
 *
 * A capture that was rejected (Cancelled) is not a duplicate of anything —
 * it was discarded on purpose, and re-uploading is the correct remedy. The
 * reviewer is still told it is the same file (layer 4), because a rejected
 * file is sometimes rejected precisely for being a duplicate.
 *
 * SD-1 — a Failed capture now counts as live: it can be entered by hand
 * (ManualEntry), so the same file uploaded again is a second copy of a
 * document still in the workflow, not a fresh attempt.
 */
export function assessDuplicate(
  subject: DuplicateSubject,
  captures: DuplicateCandidateCapture[],
  bills: DuplicateCandidateBill[],
): DuplicateDecision {
  const others = captures.filter((c) => c.captureId !== subject.captureId);
  const live = others.filter((c) => c.status !== "Cancelled");

  // Layer 1 — the same bytes.
  if (subject.contentSha256) {
    const same = live.find((c) => c.contentSha256 && c.contentSha256 === subject.contentSha256);
    if (same) {
      return {
        status: "Blocked",
        layer: "file-hash",
        reason: "This is the same file as an invoice already captured. Open that one instead of capturing it twice.",
        ofCaptureId: same.captureId,
        ofBillId: null,
      };
    }
  }

  const subjectNumber = normaliseInvoiceNumber(subject.invoiceNumber);

  // Layer 2 — one supplier, one invoice number. Checked against BOTH
  // captures in flight and bills already on the ledger, because the
  // duplicate that matters most is the one already posted.
  if (subject.supplierId !== null && subjectNumber) {
    const bill = bills.find((b) => b.supplierId === subject.supplierId && normaliseInvoiceNumber(b.invoiceNumber) === subjectNumber);
    if (bill) {
      return {
        status: "Blocked",
        layer: "supplier-invoice-number",
        reason: `Invoice ${subject.invoiceNumber} from this supplier is already on the ledger as bill #${bill.billId}.`,
        ofCaptureId: null,
        ofBillId: bill.billId,
      };
    }
    const capture = live.find(
      (c) => c.supplierId === subject.supplierId && normaliseInvoiceNumber(c.invoiceNumber) === subjectNumber,
    );
    if (capture) {
      return {
        status: "Blocked",
        layer: "supplier-invoice-number",
        reason: `Invoice ${subject.invoiceNumber} from this supplier has already been captured.`,
        ofCaptureId: capture.captureId,
        ofBillId: null,
      };
    }
  }

  // Layer 3 — same supplier, same money, close together, different number.
  // Worth a look, not a block: suppliers do legitimately issue two invoices
  // of the same value in a week.
  if (subject.supplierId !== null && subject.total !== null) {
    for (const bill of bills) {
      if (bill.supplierId !== subject.supplierId || !sameMoney(bill.total, subject.total)) continue;
      const gap = daysBetween(bill.invoiceDate, subject.invoiceDate);
      if (gap !== null && gap <= DATE_WINDOW_DAYS) {
        return {
          status: "Possible",
          layer: "supplier-total-window",
          reason: `Bill #${bill.billId} from this supplier is for the same amount and dated ${gap} day${gap === 1 ? "" : "s"} apart. Check it is not the same invoice.`,
          ofCaptureId: null,
          ofBillId: bill.billId,
        };
      }
    }
    for (const capture of live) {
      if (capture.supplierId !== subject.supplierId || !sameMoney(capture.total, subject.total)) continue;
      const gap = daysBetween(capture.invoiceDate, subject.invoiceDate);
      if (gap !== null && gap <= DATE_WINDOW_DAYS) {
        return {
          status: "Possible",
          layer: "supplier-total-window",
          reason: `Another captured invoice from this supplier is for the same amount and dated ${gap} day${gap === 1 ? "" : "s"} apart. Check it is not the same invoice.`,
          ofCaptureId: capture.captureId,
          ofBillId: null,
        };
      }
    }
  }

  // Layer 4 — the same bytes as a capture that was rejected.
  if (subject.contentSha256) {
    const rejected = others.find((c) => c.status === "Cancelled" && c.contentSha256 && c.contentSha256 === subject.contentSha256);
    if (rejected) return rejectedFileDecision(rejected.captureId);
  }

  return NO_DUPLICATE;
}

function rejectedFileDecision(captureId: number): DuplicateDecision {
  return {
    status: "Possible",
    layer: "file-hash",
    reason: `This is the same file as a capture that was rejected (#${captureId}). Check why it was rejected before capturing it again.`,
    ofCaptureId: captureId,
    ofBillId: null,
  };
}

/** Another stored document with the same bytes, and the capture (if any)
 * made from it. */
export type SameFileDocument = {
  documentId: number;
  filename: string;
  captureId: number | null;
  captureStatus: string | null;
};

export type FileHashDecision =
  | { kind: "none" }
  | { kind: "blocked"; ofDocumentId: number; filename: string; ofCaptureId: number | null }
  | { kind: "possible"; decision: DuplicateDecision };

/**
 * SD-1 — the upload-time file check, decided from EVERY other document with
 * the same bytes (never the uploaded document itself).
 *
 * Blocks when the same file is already:
 *  - a capture still in the workflow, or converted (any status but rejected);
 *  - a stored document with no capture at all — for example the invoice
 *    attached to a bill that was entered by hand. Capturing it again is how
 *    an invoice gets recorded twice.
 *
 * Does NOT block when the only earlier copies belong to rejected captures:
 * re-uploading a rejected document is legitimate. It is still flagged as a
 * possible duplicate so the reviewer sees the history.
 */
export function assessFileHashMatches(uploadedDocumentId: number, matches: SameFileDocument[]): FileHashDecision {
  const others = matches.filter((m) => m.documentId !== uploadedDocumentId).sort((a, b) => a.documentId - b.documentId);
  const blocking = others.find((m) => m.captureId === null || m.captureStatus !== "Cancelled");
  if (blocking) {
    return { kind: "blocked", ofDocumentId: blocking.documentId, filename: blocking.filename, ofCaptureId: blocking.captureId };
  }
  const rejected = others.find((m) => m.captureId !== null && m.captureStatus === "Cancelled");
  if (rejected) return { kind: "possible", decision: rejectedFileDecision(rejected.captureId!) };
  return { kind: "none" };
}

/** The one place that decides whether a duplicate verdict stops a
 * conversion. `Possible` does not: the reviewer has been shown it and is
 * entitled to proceed. `Blocked` always does. */
export function blocksConversion(decision: Pick<DuplicateDecision, "status">): boolean {
  return decision.status === "Blocked";
}
