/**
 * Phase 5L — deterministic validation of an AI extraction.
 *
 * This module is the reason the feature is safe to build at all.
 *
 * VYRON COST measured a scanned invoice where the model returned invented
 * prices on 11 of 12 rows, at `confidenceScore: 95` on every one, with
 * valid JSON, a matching row count and correct header totals. Their own
 * write-up: *"Every check in place at the time passed. The failure was
 * invisible."* The value it read was a WEIGHT column printed between
 * `UNIT PRICE` and `V.A.T.`.
 *
 * So nothing here consults confidence. Every signal below is arithmetic
 * the extraction cannot satisfy by being confident about being wrong.
 *
 * CRITICALLY: this module NEVER overwrites what was extracted. It reports
 * agreement or disagreement. The brief is explicit — an independently
 * reconciled R11,350 against an extracted R11,500 means REVIEW REQUIRED,
 * not a silent correction to either figure. A human decides which is right,
 * with the document in front of them.
 */

import type { ExtractedLine, ExtractionResult, ValidationStatus } from "./types";

/** The one rounding rule, matching `purchasing/line-amounts.ts` and the
 * rest of the accounting paths. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Money comparison tolerance — half a cent, so representation noise never
 * reads as a discrepancy. */
const CENT = 0.005;
/** How far the header total may sit from the summed lines before it is a
 * finding rather than rounding. Suppliers legitimately round a document
 * total by a cent or two across many lines. */
export const ROUNDING_TOLERANCE = 0.05;
/** A gap larger than this is a real disagreement, not rounding. */
export const MATERIAL_DIFFERENCE = 1.0;

/** Fraction of checkable rows that must reconcile for the table to be
 * believable. Below this the column mapping is presumed wrong. */
export const COHERENCE_THRESHOLD = 0.6;
/** A repeated money value across this share of rows, with at least
 * `CONSTANT_COLUMN_MIN_ROWS` rows, means a non-money column was read as
 * money. This is the exact COST failure. */
export const CONSTANT_COLUMN_DOMINANCE = 0.6;
export const CONSTANT_COLUMN_MIN_ROWS = 5;

export type ValidationFinding = {
  code:
    | "constant-money-column"
    | "lines-incoherent"
    | "line-incoherent"
    | "totals-disagree"
    | "line-vat-disagrees-with-header"
    | "line-vat-disagrees-with-rate"
    | "row-count-short"
    | "no-lines"
    | "missing-required-field"
    | "not-an-invoice"
    | "multiple-invoices"
    | "negative-amount";
  severity: "blocking" | "review";
  message: string;
  /** Which line (0-based), when the finding is about one row. */
  lineIndex?: number;
};

export type ReconciliationBasis = "exclusive" | "inclusive" | "indeterminate";

export type TotalsReconciliation = {
  /** Sum of the lines' own net (qty × price − discount) where readable. */
  lineNetSum: number;
  lineVatSum: number;
  /** Sum of the printed line totals. */
  lineTotalSum: number;
  /** Whether the printed line-total column looks VAT-inclusive or not.
   * Suppliers differ, and assuming one basis rejects correct documents —
   * COST hit exactly that and it drove a retry loop chasing rows that were
   * never missing. */
  basis: ReconciliationBasis;
  /** Extracted header figures, unchanged. */
  extractedSubtotal: number | null;
  extractedVat: number | null;
  extractedTotal: number | null;
  /** Independently computed from the lines. NOT written anywhere. */
  computedSubtotal: number | null;
  computedVat: number | null;
  computedTotal: number | null;
  /** Largest absolute disagreement between extracted and computed. */
  maxAbsDifference: number | null;
  agrees: boolean;
  withinRounding: boolean;
};

/** Net of one line as printed: quantity × unit price, less any discount. */
/**
 * What the line's VAT should be, from the rate the document itself prints.
 *
 * Null whenever the question does not arise: no rate printed (most
 * documents), no readable net, or no VAT amount to compare against.
 * Returning null rather than assuming 15% matters — inferring a rate the
 * page does not state would be inventing the tax.
 *
 * VAT is charged AFTER discount, which `lineNet` already handles. Taxing
 * the pre-discount amount is the exact defect Phase 5J fixed in Finance's
 * own invoicing, and it must not be reintroduced here.
 */
export function expectedVatFromRate(line: ExtractedLine): number | null {
  if (!isNum(line.vatRatePercent)) return null;
  const net = lineNet(line);
  if (net === null) return null;
  return round2(net * (line.vatRatePercent / 100));
}

export function lineNet(line: ExtractedLine): number | null {
  if (!isNum(line.quantity) || !isNum(line.unitPrice)) return null;
  const gross = line.quantity * line.unitPrice;
  const discount = isNum(line.discount) ? line.discount : 0;
  return round2(gross - discount);
}

/**
 * Per-line arithmetic coherence.
 *
 * A printed line total must equal the line's net, or the net plus its VAT —
 * because suppliers differ on whether that column includes tax. Both
 * readings are accepted; neither is assumed.
 */
export function assessLineCoherence(line: ExtractedLine): { checkable: boolean; coherent: boolean; basis: ReconciliationBasis } {
  const net = lineNet(line);
  if (net === null || !isNum(line.lineTotal)) return { checkable: false, coherent: false, basis: "indeterminate" };

  if (Math.abs(line.lineTotal - net) <= CENT) return { checkable: true, coherent: true, basis: "exclusive" };

  const vat = isNum(line.vatAmount) ? line.vatAmount : null;
  if (vat !== null && Math.abs(line.lineTotal - round2(net + vat)) <= CENT) {
    return { checkable: true, coherent: true, basis: "inclusive" };
  }
  // A printed VAT rate is a third legitimate way to reach the same total.
  if (isNum(line.vatRatePercent)) {
    const derived = round2(net + round2(net * (line.vatRatePercent / 100)));
    if (Math.abs(line.lineTotal - derived) <= CENT) return { checkable: true, coherent: true, basis: "inclusive" };
  }
  return { checkable: true, coherent: false, basis: "indeterminate" };
}

/**
 * Detects a column that is not money being read as money.
 *
 * A per-line amount is a function of its own line. When the SAME value
 * appears as `unitPrice` or `vatAmount` on most rows of a table with
 * several distinct line totals, the model has locked onto a column that
 * does not vary per line — a weight, a pack size, a tax code.
 *
 * A column of zeros is exempt: that is a zero-rated invoice, not a misread.
 */
export function detectConstantMoneyColumn(lines: ExtractedLine[]): { field: "unitPrice" | "vatAmount"; value: number } | null {
  const distinctTotals = new Set(lines.map((l) => l.lineTotal).filter(isNum).map((v) => round2(v)));
  if (lines.length < CONSTANT_COLUMN_MIN_ROWS || distinctTotals.size < 3) return null;

  for (const field of ["unitPrice", "vatAmount"] as const) {
    const values = lines.map((l) => l[field]).filter(isNum).map((v) => round2(v));
    if (values.length < CONSTANT_COLUMN_MIN_ROWS) continue;
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [value, count] of counts) {
      if (value === 0) continue; // a zero-rated column is a fact, not a misread
      if (count / values.length >= CONSTANT_COLUMN_DOMINANCE) return { field, value };
    }
  }
  return null;
}

/**
 * Reconciles the lines against the header WITHOUT changing either.
 *
 * The basis is inferred from how the lines themselves behave, then the
 * computed figures are compared with what was extracted.
 */
export function reconcileTotals(result: ExtractionResult): TotalsReconciliation {
  const lines = result.lines.filter((l) => !isEmptyLine(l));
  const nets = lines.map(lineNet);
  const anyNet = nets.some((n) => n !== null);

  const lineNetSum = round2(nets.reduce<number>((s, n) => s + (n ?? 0), 0));
  const lineVatSum = round2(lines.reduce<number>((s, l) => s + (isNum(l.vatAmount) ? l.vatAmount : 0), 0));
  const lineTotalSum = round2(lines.reduce<number>((s, l) => s + (isNum(l.lineTotal) ? l.lineTotal : 0), 0));

  const bases = lines.map((l) => assessLineCoherence(l)).filter((a) => a.checkable && a.coherent).map((a) => a.basis);
  const inclusive = bases.filter((b) => b === "inclusive").length;
  const exclusive = bases.filter((b) => b === "exclusive").length;
  const basis: ReconciliationBasis = inclusive === 0 && exclusive === 0 ? "indeterminate" : inclusive > exclusive ? "inclusive" : "exclusive";

  const computedSubtotal = anyNet ? lineNetSum : null;
  const computedVat = lines.some((l) => isNum(l.vatAmount)) ? lineVatSum : null;
  const computedTotal =
    computedSubtotal === null ? null : round2(computedSubtotal + (computedVat ?? 0));

  const diffs: number[] = [];
  const { subtotal, vatAmount, total } = result.header;
  if (isNum(subtotal) && computedSubtotal !== null) diffs.push(Math.abs(subtotal - computedSubtotal));
  if (isNum(vatAmount) && computedVat !== null) diffs.push(Math.abs(vatAmount - computedVat));
  if (isNum(total) && computedTotal !== null) diffs.push(Math.abs(total - computedTotal));

  const maxAbsDifference = diffs.length ? round2(Math.max(...diffs)) : null;
  return {
    lineNetSum,
    lineVatSum,
    lineTotalSum,
    basis,
    extractedSubtotal: subtotal,
    extractedVat: vatAmount,
    extractedTotal: total,
    computedSubtotal,
    computedVat,
    computedTotal,
    maxAbsDifference,
    agrees: maxAbsDifference !== null && maxAbsDifference <= ROUNDING_TOLERANCE,
    withinRounding: maxAbsDifference !== null && maxAbsDifference <= MATERIAL_DIFFERENCE,
  };
}

function isEmptyLine(line: ExtractedLine): boolean {
  return (
    !line.description?.trim() &&
    !isNum(line.quantity) &&
    !isNum(line.unitPrice) &&
    !isNum(line.lineTotal)
  );
}

/**
 * Multi-invoice (batch scan) detection.
 *
 * One file carrying several invoice numbers is refused outright rather than
 * merged. Merging is how COST nearly duplicated R121,823 of cost from a
 * single upload.
 */
export function assessInvoiceBoundary(result: ExtractionResult): { kind: "single" | "multiple"; numbers: string[] } {
  const seen = new Set<string>();
  for (const n of result.invoiceNumbersSeen) {
    const key = normaliseInvoiceNumber(n);
    if (key) seen.add(key);
  }
  const headerKey = normaliseInvoiceNumber(result.header.invoiceNumber);
  if (headerKey) seen.add(headerKey);
  return seen.size > 1 ? { kind: "multiple", numbers: [...seen] } : { kind: "single", numbers: [...seen] };
}

/** Upper-cased, non-alphanumerics removed — so `INV-001` and `inv001` are
 * the same serial number, which is what matters for both boundary
 * detection and duplicate detection. */
export function normaliseInvoiceNumber(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Header fields without which a supplier bill cannot responsibly be
 * created. Everything else can be filled in by the reviewer. */
export const REQUIRED_HEADER_FIELDS = ["supplierName", "invoiceNumber", "invoiceDate", "total"] as const;

export type ValidationReport = {
  status: ValidationStatus;
  findings: ValidationFinding[];
  reconciliation: TotalsReconciliation;
  coherentRows: number;
  checkableRows: number;
  /** Rows that individually failed coherence while the table as a whole
   * passed. Surfaced as a warning against that row, not a rejection —
   * discarding 15 good rows to re-read 1 is not an improvement. */
  incoherentRowIndexes: number[];
};

/**
 * The whole assessment. `status` is what drives the workflow:
 *
 *   Incomplete → the extraction is not usable; retry is warranted
 *   Review     → usable, but a human must resolve a disagreement
 *   Pass       → the document reconciles with itself
 *
 * A retry is justified by `Incomplete` ONLY. Never by confidence.
 */
export function validateExtraction(result: ExtractionResult): ValidationReport {
  const findings: ValidationFinding[] = [];
  const lines = result.lines.filter((l) => !isEmptyLine(l));

  for (const field of REQUIRED_HEADER_FIELDS) {
    const value = result.header[field];
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
      findings.push({
        code: "missing-required-field",
        severity: "review",
        message: `The document's ${humanField(field)} could not be read. Enter it before converting this invoice.`,
      });
    }
  }

  /* Phase 5M — a supplier CREDIT note reduces what is owed. Booking one
   * as a bill would increase it instead: the opposite sign, silently, on
   * a real liability. Finance's `ae_imported_bills` does carry a
   * `document_type` of 'Bill' | 'Credit Note' | 'Debit Note', but this
   * capture flow only ever creates a Bill, so a credit note is refused
   * rather than mis-booked. Handling them properly is its own change —
   * see the phase report's required improvements. */
  const documentType = result.header.documentType;
  if (documentType && documentType !== "Invoice") {
    findings.push({
      code: "not-an-invoice",
      severity: "blocking",
      message:
        documentType === "Other"
          ? "This does not look like a supplier invoice. Capture is for invoices; check the document."
          : `This is a ${documentType.toLowerCase()}, not an invoice. Supplier ${documentType.toLowerCase()}s cannot be captured yet — capture it by hand so it reduces the balance rather than adding to it.`,
    });
  }

  const boundary = assessInvoiceBoundary(result);
  if (boundary.kind === "multiple") {
    findings.push({
      code: "multiple-invoices",
      severity: "blocking",
      message: `This file contains ${boundary.numbers.length} different invoice numbers (${boundary.numbers.join(", ")}). Split it and upload each invoice separately.`,
    });
  }

  if (lines.length === 0) {
    findings.push({ code: "no-lines", severity: "blocking", message: "No invoice lines could be read from this document." });
  }

  if (isNum(result.declaredLineCount) && result.declaredLineCount > lines.length) {
    findings.push({
      code: "row-count-short",
      severity: "blocking",
      message: `The document appears to have ${result.declaredLineCount} lines but only ${lines.length} were read.`,
    });
  }

  const constant = detectConstantMoneyColumn(lines);
  if (constant) {
    findings.push({
      code: "constant-money-column",
      severity: "blocking",
      message: `Every line shows the same ${constant.field === "unitPrice" ? "unit price" : "VAT amount"} of ${constant.value.toFixed(2)}. A per-line amount varies by line, so a column that is not money has probably been read as money.`,
    });
  }

  const assessments = lines.map((l) => assessLineCoherence(l));
  const checkableRows = assessments.filter((a) => a.checkable).length;
  const coherentRows = assessments.filter((a) => a.checkable && a.coherent).length;
  const incoherentRowIndexes = assessments.map((a, i) => (a.checkable && !a.coherent ? i : -1)).filter((i) => i >= 0);

  if (checkableRows > 0 && coherentRows / checkableRows < COHERENCE_THRESHOLD) {
    findings.push({
      code: "lines-incoherent",
      severity: "blocking",
      message: `Only ${coherentRows} of ${checkableRows} lines add up. The figures on this document were probably read from the wrong columns.`,
    });
  } else {
    for (const index of incoherentRowIndexes) {
      findings.push({
        code: "line-incoherent",
        severity: "review",
        lineIndex: index,
        message: `Line ${index + 1} does not add up: check the quantity, unit price and total against the document.`,
      });
    }
  }

  for (const [index, line] of lines.entries()) {
    for (const [field, value] of [["quantity", line.quantity], ["unitPrice", line.unitPrice], ["lineTotal", line.lineTotal]] as const) {
      if (isNum(value) && value < 0) {
        findings.push({
          code: "negative-amount",
          severity: "review",
          lineIndex: index,
          message: `Line ${index + 1} has a negative ${humanField(field)}. Check it against the document — a credit note should be captured as one.`,
        });
      }
    }
  }

  /*
   * Phase 5Q.6 — VAT against the rate the document itself states.
   *
   * THE GAP THIS CLOSES. Every other check here compares printed figures
   * to OTHER printed figures. An invoice showing net 1 000.00, VAT 15%
   * and VAT 165.00 with a total of 1 165.00 is internally consistent —
   * the lines add up, the total agrees, the line VAT equals the header
   * VAT — and it is still wrong, because 15% of 1 000.00 is 150.00. The
   * rate was never used as an independent source of truth, so the
   * document passed clean. This is the one check that reads the rate.
   *
   * WHY ABSOLUTE 0.05 AND NOT A PERCENTAGE. The only thing being
   * tolerated is rounding, and rounding does not scale with the invoice:
   * a million-rand line rounds to the cent exactly as a ten-rand one
   * does. A relative tolerance would grow the blind spot with the amount
   * — R3 000 unnoticed on a million — which is backwards for materiality.
   * `ROUNDING_TOLERANCE` already means "this is rounding, not a
   * disagreement", which is precisely the distinction here.
   *
   * REVIEW, NOT BLOCKING. The extraction may well be correct; it is the
   * DOCUMENT that disagrees with itself. That is a question for a person,
   * exactly as `totals-disagree` is.
   */
  const rateChecked: number[] = [];
  const rateFailed: number[] = [];
  for (const [index, line] of lines.entries()) {
    const expectedVat = expectedVatFromRate(line);
    if (expectedVat === null || !isNum(line.vatAmount)) continue;
    rateChecked.push(index);
    // The difference is rounded to cents BEFORE comparing. Without it,
    // 150.05 - 150 is 0.05000000000000426 in binary floating point and a
    // document that is exactly at the tolerance would be reported as
    // beyond it.
    if (round2(Math.abs(line.vatAmount - expectedVat)) > ROUNDING_TOLERANCE) rateFailed.push(index);
  }

  // The summary form needs enough rows for "most of them" to mean
  // anything. With one line, one failure is 100% of the table and would
  // always collapse into a summary that named no line — losing exactly the
  // detail a reviewer needs.
  if (
    rateChecked.length >= CONSTANT_COLUMN_MIN_ROWS &&
    rateFailed.length / rateChecked.length > 1 - COHERENCE_THRESHOLD
  ) {
    // Most rated rows disagreeing is a column-mapping problem, not an
    // arithmetic one. One finding says that better than N.
    findings.push({
      code: "line-vat-disagrees-with-rate",
      severity: "review",
      message:
        `${rateFailed.length} of ${rateChecked.length} lines show VAT that does not match the rate printed on them. ` +
        `Check the VAT column against the document.`,
    });
  } else {
    for (const index of rateFailed) {
      const line = lines[index];
      const expectedVat = expectedVatFromRate(line)!;
      findings.push({
        code: "line-vat-disagrees-with-rate",
        severity: "review",
        lineIndex: index,
        message:
          `Line ${index + 1} shows VAT of ${fmt(line.vatAmount)}, but ${line.vatRatePercent}% of ${fmt(lineNet(line))} is ${fmt(expectedVat)}. ` +
          `Check the VAT against the document — the invoice may be wrong.`,
      });
    }
  }

  const reconciliation = reconcileTotals(result);
  if (reconciliation.maxAbsDifference !== null && !reconciliation.agrees) {
    findings.push({
      code: "totals-disagree",
      severity: "review",
      message:
        `The invoice's own totals and the sum of its lines differ by ${reconciliation.maxAbsDifference.toFixed(2)}. ` +
        `Extracted total ${fmt(reconciliation.extractedTotal)}, lines add to ${fmt(reconciliation.computedTotal)}. Check which is right.`,
    });
  }

  if (
    isNum(result.header.vatAmount) &&
    reconciliation.computedVat !== null &&
    Math.abs(result.header.vatAmount - reconciliation.computedVat) > Math.max(MATERIAL_DIFFERENCE, Math.abs(result.header.vatAmount) * 0.02)
  ) {
    findings.push({
      code: "line-vat-disagrees-with-header",
      severity: "review",
      message: `The VAT on the lines (${fmt(reconciliation.computedVat)}) does not match the VAT on the invoice (${fmt(result.header.vatAmount)}).`,
    });
  }

  const status: ValidationStatus = findings.some((f) => f.severity === "blocking")
    ? "Incomplete"
    : findings.length > 0
      ? "Review"
      : "Pass";

  return { status, findings, reconciliation, coherentRows, checkableRows, incoherentRowIndexes };
}

function humanField(field: string): string {
  return (
    {
      supplierName: "supplier name",
      invoiceNumber: "invoice number",
      invoiceDate: "invoice date",
      total: "total",
      quantity: "quantity",
      unitPrice: "unit price",
      lineTotal: "line total",
    } as Record<string, string>
  )[field] ?? field;
}

function fmt(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/**
 * Whether another extraction attempt is warranted.
 *
 * ONLY a deterministic failure justifies one. Confidence is not consulted,
 * and is not a parameter of this function so it cannot be.
 */
export function shouldRetryExtraction(report: ValidationReport, attemptsSoFar: number, maxAttempts: number): boolean {
  if (attemptsSoFar >= maxAttempts) return false;
  // Findings a RE-READ can never change. Retrying these burns AI budget to
  // arrive at the same answer: the file still holds several invoices, and
  // a credit note is still a credit note however carefully it is read.
  const notFixableByRereading = new Set(["multiple-invoices", "not-an-invoice"]);
  return report.status === "Incomplete" && report.findings.some((f) => f.severity === "blocking" && !notFixableByRereading.has(f.code));
}
