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
   * What kind of document this was read as — Phase 5N.
   *
   * Carried here ONLY so conversion can refuse it. It is deliberately NOT
   * passed on to `createPurchaseBill`, which would accept a `documentType`
   * of "Credit Note" quite happily — see the block below for why that
   * would be the wrong thing to do here.
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
    | "not-an-invoice"
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
  }

  /*
   * Phase 5N — the credit/debit note boundary.
   *
   * THE ACCOUNTING CONSEQUENCE THIS PREVENTS: a supplier credit note
   * REDUCES what the company owes. This function's only output is a
   * purchase BILL, which INCREASES it. Convert one and the supplier's
   * balance moves the wrong way by twice the document — the amount that
   * should have come off, plus the amount that went on — and it does so
   * silently, because every figure on the resulting bill is correct. Only
   * its sign is wrong, and a sign is not something a reviewer checking
   * totals will see.
   *
   * WHY THIS IS A REFUSAL AND NOT A FEATURE: `createPurchaseBill` does
   * take a `documentType` of "Credit Note", so making this "work" is a
   * one-line change. That is exactly why it is written out here. Booking
   * a credit note correctly means the whole chain — posting rules, VAT
   * return treatment, allocation against the original bill, the supplier
   * ageing — agrees about the sign. None of that has been verified for
   * this path, and a one-line change that produces a plausible-looking
   * wrong number is the most dangerous kind.
   *
   * This block is deliberately INDEPENDENT of the `not-an-invoice`
   * validation finding. That finding depends on the model having read the
   * document's type; this one is a second, structural refusal that holds
   * even if validation said Pass. Either alone would be a single point of
   * failure for an error that is invisible once posted.
   */
  const documentType = subject.documentType?.trim();
  if (documentType && documentType.toLowerCase() !== "invoice") {
    blocks.push({
      code: "not-an-invoice",
      message:
        `This is a ${documentType.toLowerCase()}, not an invoice. Capturing it as a supplier bill would ` +
        `increase what you owe instead of reducing it. Enter it by hand as a supplier ${documentType.toLowerCase()}.`,
    });
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
        `VYRON cannot yet convert a supplier invoice into ${baseCurrency}, and capturing it unconverted ` +
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
    if (!isPositive(line.quantity) || !isFiniteNumber(line.unitPrice)) {
      blocks.push({
        code: "line-missing-amounts",
        lineOrder: line.lineOrder,
        message: `Line ${line.lineOrder + 1} needs a quantity and a unit price.`,
      });
    }
  }

  if (blocks.length > 0) return { ok: false, blocks };

  const lines: BillLineInput[] = included.map((line) => ({
    description: line.description?.trim() || "(no description)",
    glAccount: line.glAccount!.trim(),
    vatCode: line.vatCode!.trim(),
    quantity: line.quantity!,
    unitCost: line.unitPrice!,
    discount: isFiniteNumber(line.discount) ? line.discount! : 0,
  }));

  return {
    ok: true,
    input: {
      supplierId: subject.supplierId!,
      invoiceNumber: subject.invoiceNumber!.trim(),
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
