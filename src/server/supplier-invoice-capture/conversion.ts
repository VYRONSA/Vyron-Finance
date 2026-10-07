/**
 * Phase 5L — turning a reviewed capture into a DRAFT purchase bill.
 *
 * This is the accounting boundary, and it is deliberately the narrowest
 * part of the feature.
 *
 * WHAT THIS DOES: builds a `CreatePurchaseBillInput` from values a human
 * has reviewed, and refuses to build one when anything required is
 * missing, unresolved or blocked.
 *
 * WHAT THIS DOES NOT DO: any accounting. It computes no VAT, no totals, no
 * journal. `createPurchaseBill` → `summarizeBillLines` → `computeLineAmounts`
 * remains the authority on every figure, exactly as it is for a bill typed
 * in by hand, and `approveAndPostBill` remains the only thing that posts.
 * The AI's numbers are proposals that a person confirmed; the accounting
 * engine recomputes from them.
 *
 * THERE IS NO `force` PARAMETER. VYRON COST's client hard-coded
 * `force: true` on its bulk approve, which made its validator's `blocked`
 * unconditionally false and wrote costs, inventory movements and Xero rows
 * past every quality rule behind a single confirm dialog. Nothing in this
 * module accepts an override, a PIN, or an actor from a request body —
 * see `assertNoBypass` at the bottom, which exists so that stays true.
 */

import type { BillLineInput, CreatePurchaseBillInput } from "@/server/services/purchase-bill-service";
import { blocksConversion, type DuplicateDecision } from "./duplicate-detection";
import type { ValidationStatus } from "./types";

export type ConversionLine = {
  lineOrder: number;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  /** What the reviewer confirmed, falling back to what was suggested. */
  glAccount: string | null;
  vatCode: string | null;
  isExcluded: boolean;
};

export type ConversionSubject = {
  captureId: number;
  status: string;
  supplierId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  validationStatus: ValidationStatus;
  duplicate: Pick<DuplicateDecision, "status" | "reason">;
  /** Set once converted. Present means this capture already has a bill. */
  existingBillId: number | null;
  /**
   * What kind of document this is — read by extraction, confirmed or
   * corrected by the reviewer. SD-1: an Invoice (or unknown) becomes a
   * Draft supplier Bill; a Credit Note becomes a Draft supplier Credit
   * Note; anything else is refused. See the block below.
   */
  documentType: string | null;
  /**
   * The currency printed on the document, and the company's own — Phase
   * 5N. Both are needed, because "is this foreign?" is a question about
   * the pair, not about either one alone.
   */
  currencyCode: string | null;
  baseCurrencyCode: string;
  lines: ConversionLine[];
};

export type ConversionBlock = {
  code:
    | "already-converted"
    | "wrong-status"
    | "duplicate-blocked"
    | "no-supplier"
    | "missing-invoice-number"
    | "missing-invoice-date"
    | "validation-incomplete"
    | "validation-pending"
    | "not-an-invoice"
    | "credit-note-mixed-signs"
    | "foreign-currency-unsupported"
    | "no-lines"
    | "line-missing-gl-account"
    | "line-missing-vat-code"
    | "line-missing-amounts";
  message: string;
  lineOrder?: number;
};

export type ConversionAssessment =
  | { ok: true; input: CreatePurchaseBillInput }
  | { ok: false; blocks: ConversionBlock[] };

/**
 * Every reason a capture may not become a bill, evaluated together so the
 * reviewer is told all of them at once rather than one per attempt.
 *
 * Note which of these are absolute:
 *  - a BLOCKED duplicate, always;
 *  - an `Incomplete` validation, because that means the extraction itself
 *    was rejected by arithmetic, not merely questioned;
 *  - an unresolved supplier, because a bill must name a real party;
 *  - a line without a GL account or VAT code, because
 *    `ae_purchase_bill_lines` requires both and a bill is not a place to
 *    discover that.
 *
 * A `Review` validation status is NOT a block. The reviewer has been shown
 * the disagreement and is entitled to decide — that is what review is.
 */
export function assessConversion(subject: ConversionSubject): ConversionAssessment {
  const blocks: ConversionBlock[] = [];

  if (subject.existingBillId !== null) {
    blocks.push({
      code: "already-converted",
      message: `This invoice has already been converted to bill #${subject.existingBillId}.`,
    });
    // Return immediately: idempotency is not a list of problems to fix.
    return { ok: false, blocks };
  }

  if (subject.status !== "NeedsReview") {
    blocks.push({
      code: "wrong-status",
      message: `Only an invoice that is ready for review can be converted (this one is ${subject.status}).`,
    });
  }

  if (blocksConversion(subject.duplicate)) {
    blocks.push({
      code: "duplicate-blocked",
      message: subject.duplicate.reason || "This invoice has already been captured.",
    });
  }

  if (subject.validationStatus === "Incomplete") {
    blocks.push({
      code: "validation-incomplete",
      message: "This document could not be read reliably. Correct the figures against the invoice, or capture it by hand.",
    });
  } else if (subject.validationStatus === "Pending") {
    // SD-1 — every reviewer correction resets validation. A capture is only
    // converted on a verdict about the values being converted.
    blocks.push({
      code: "validation-pending",
      message: "The corrected invoice has not been validated yet. Validate it again before converting.",
    });
  }

  /*
   * The document-type boundary (Phase 5N; credit notes enabled in SD-1).
   *
   * A supplier credit note REDUCES what the company owes; a bill INCREASES
   * it. Booked as a bill, a credit note moves the balance the wrong way by
   * twice the document, silently. So the output's document type is decided
   * HERE, structurally, from the reviewed document type — never left to a
   * default:
   *
   *   Invoice (or not stated) -> a Draft supplier "Bill"
   *   Credit Note             -> a Draft supplier "Credit Note"
   *   anything else           -> refused
   *
   * SD-1 verified the existing credit-note path before enabling it:
   * `createPurchaseBill` stores a Credit Note with positive amounts, and
   * `approveAndPostBill` posts it through the seeded "Supplier Credit Note"
   * rule (DR Creditors gross / CR expense net / CR VAT Input vat) after the
   * same Submit -> Approve (with approval limit) workflow as a bill. The VAT
   * return signs it as a reversal. No new posting mechanism exists here.
   * (Known, pre-existing and unchanged: the supplier sub-ledger views —
   * outstanding balance, per-supplier ageing, payment allocation — treat a
   * credit note's `outstanding` like a bill's. See the SD-1 report.)
   *
   * Debit notes stay refused: enabling them is a separate decision.
   */
  const documentType = subject.documentType?.trim() || null;
  const typeKey = documentType?.toLowerCase() ?? null;
  const isCreditNote = typeKey === "credit note";
  if (typeKey && typeKey !== "invoice" && !isCreditNote) {
    blocks.push({
      code: "not-an-invoice",
      message:
        `This is a ${typeKey}. Supplier ${typeKey}s cannot be captured yet — ` +
        `enter it by hand so it is booked with the right sign.`,
    });
  }

  // A credit note may print its amounts negative. It is booked positive
  // with the Credit Note document type carrying the sign — so every
  // included line must agree on one sign, or the abs() below would be wrong.
  const includedForSign = subject.lines.filter((l) => !l.isExcluded);
  if (isCreditNote) {
    const signs = new Set(
      includedForSign
        .map((l) => (isFiniteNumber(l.quantity) && isFiniteNumber(l.unitPrice) ? Math.sign(l.quantity * l.unitPrice) : 0))
        .filter((s) => s !== 0),
    );
    if (signs.size > 1) {
      blocks.push({
        code: "credit-note-mixed-signs",
        message: "This credit note has both positive and negative lines. Correct the lines so they agree, or enter it by hand.",
      });
    }
  }

  /*
   * Phase 5N — the foreign-currency boundary.
   *
   * THE ACCOUNTING CONSEQUENCE THIS PREVENTS: `CreatePurchaseBillInput`
   * has no currency field. Not a defaulted one — none. Every amount handed
   * to it is stored and posted as the company's base currency. A USD 1,200
   * invoice therefore becomes a bill for R1,200, understating the
   * liability by roughly eighteen thousand rand at any recent rate, and
   * nothing anywhere in the chain would flag it, because R1,200 is a
   * perfectly ordinary number.
   *
   * The three things this must not do instead, and does not:
   *  - convert the amount (there is no rate source, and inventing one is
   *    inventing the liability);
   *  - apply a rate from anywhere (same reason);
   *  - treat the foreign amount as base currency (the defect above).
   *
   * A null currency is NOT foreign. Most documents in a ZAR company do not
   * print a currency code at all, and refusing those would refuse almost
   * everything for no safety gain.
   */
  const printedCurrency = subject.currencyCode?.trim().toUpperCase();
  // A missing base currency falls back to ZAR rather than to "no check".
  // Every other reader of this field does the same
  // (`report-centre/production-source.ts`), and a guard that disappears
  // when a field is absent is not a guard.
  const baseCurrency = subject.baseCurrencyCode?.trim().toUpperCase() || "ZAR";
  if (printedCurrency && printedCurrency !== baseCurrency) {
    blocks.push({
      code: "foreign-currency-unsupported",
      message:
        `This invoice is in ${printedCurrency}, and this company's books are in ${baseCurrency}. ` +
        `PRECISIA cannot yet convert a supplier invoice into ${baseCurrency}, and capturing it unconverted ` +
        `would record the wrong amount. Enter this one by hand at the rate you are using.`,
    });
  }

  if (subject.supplierId === null) {
    blocks.push({ code: "no-supplier", message: "Choose the supplier this invoice is from." });
  }
  if (!subject.invoiceNumber?.trim()) {
    blocks.push({ code: "missing-invoice-number", message: "Enter the supplier's invoice number." });
  }
  if (!subject.invoiceDate) {
    blocks.push({ code: "missing-invoice-date", message: "Enter the invoice date." });
  }

  const included = subject.lines.filter((l) => !l.isExcluded);
  if (included.length === 0) {
    blocks.push({ code: "no-lines", message: "A bill needs at least one line. Include a line, or cancel this invoice." });
  }

  for (const line of included) {
    if (!line.glAccount?.trim()) {
      blocks.push({ code: "line-missing-gl-account", lineOrder: line.lineOrder, message: `Line ${line.lineOrder + 1} needs a GL account.` });
    }
    if (!line.vatCode?.trim()) {
      blocks.push({ code: "line-missing-vat-code", lineOrder: line.lineOrder, message: `Line ${line.lineOrder + 1} needs a VAT code.` });
    }
    const quantity = isCreditNote && isFiniteNumber(line.quantity) ? Math.abs(line.quantity) : line.quantity;
    if (!isPositive(quantity) || !isFiniteNumber(line.unitPrice)) {
      blocks.push({
        code: "line-missing-amounts",
        lineOrder: line.lineOrder,
        message: `Line ${line.lineOrder + 1} needs a quantity and a unit price.`,
      });
    }
  }

  if (blocks.length > 0) return { ok: false, blocks };

  // For a credit note the sign lives in the document type, so amounts are
  // carried as magnitudes (every line was checked above to share one sign).
  const magnitude = (value: number) => (isCreditNote ? Math.abs(value) : value);
  const lines: BillLineInput[] = included.map((line) => ({
    description: line.description?.trim() || "(no description)",
    glAccount: line.glAccount!.trim(),
    vatCode: line.vatCode!.trim(),
    quantity: magnitude(line.quantity!),
    unitCost: magnitude(line.unitPrice!),
    discount: isFiniteNumber(line.discount) ? magnitude(line.discount!) : 0,
  }));

  return {
    ok: true,
    input: {
      supplierId: subject.supplierId!,
      invoiceNumber: subject.invoiceNumber!.trim(),
      documentType: isCreditNote ? "Credit Note" : "Bill",
      invoiceDate: subject.invoiceDate!,
      dueDate: subject.dueDate ?? null,
      // The multi-line path: header VAT and total become a real roll-up of
      // the lines, computed by the bill service. No header figure from the
      // extraction is carried across — if the document's stated total
      // disagrees with its lines, that was surfaced at review and the
      // lines are what the reviewer signed off.
      lines,
    },
  };
}

/**
 * SD-1 — the amount a conversion's approval limit is checked against.
 *
 * Previously the route used the EXTRACTED header total, which a reviewer
 * could not correct and which — when missing — became 0 and passed every
 * limit. Now:
 *
 *  - `computedDocumentTotal` is the total the purchase-bill engine itself
 *    computes from the reviewed lines (the figure the Draft document will
 *    actually carry). It is required: if it cannot be computed, there is
 *    no amount, and the caller must refuse — never fall back to zero.
 *  - `reviewedHeaderTotal` is the reviewed total printed on the document.
 *    When present, the LARGER of the two is used, so a total that the lines
 *    under-state can never slip under a limit.
 *
 * Both are magnitudes: a credit note's approval is about its size.
 */
export function conversionApprovalAmount(computedDocumentTotal: number, reviewedHeaderTotal: number | null): number {
  if (!Number.isFinite(computedDocumentTotal) || computedDocumentTotal <= 0) {
    throw new Error("The document total could not be computed, so there is no amount to check an approval limit against.");
  }
  const header = isFiniteNumber(reviewedHeaderTotal) ? Math.abs(reviewedHeaderTotal) : 0;
  return Math.round(Math.max(Math.abs(computedDocumentTotal), header) * 100) / 100;
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: number | null): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * A structural guard, asserted by `conversion.test.ts`.
 *
 * `assessConversion` takes exactly one argument. It cannot be handed an
 * options bag, so there is nowhere for a `force`, an override PIN or a
 * caller-supplied approver to be introduced without changing its signature
 * — which is the change a reviewer would notice.
 */
export function assertNoBypass(): void {
  if (assessConversion.length !== 1) {
    throw new Error(
      "assessConversion must take exactly one argument. A second parameter is how a force/override flag enters a system — see VYRON COST's bulk approve.",
    );
  }
}
