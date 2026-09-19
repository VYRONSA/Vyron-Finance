/**
 * Phase 5J — THE authoritative Sales Invoice calculation.
 *
 * Before this existed, a Sales Invoice's figures were produced in three
 * places that could disagree: the React form added up
 * `quantity * unitPrice`, `sales-invoice-repository.ts::computeTotals`
 * applied one flat header VAT rate to that sum and ignored every
 * per-line `vatCode`/`discount` the form had just captured, and
 * `approveAndPostInvoice` re-derived the net/VAT split a third time from
 * the saved `total` via `splitGrossAmount`. This module is the single
 * definition all three now use.
 *
 * Pure, and imports nothing but `line-amounts.ts` (which itself imports
 * nothing) — the same discipline `general-ledger/amount-split.ts`
 * follows, so the "use client" invoice form can preview the identical
 * arithmetic without dragging `@/lib/supabase/server` into a client
 * bundle. The preview is a preview: the server recomputes from scratch
 * on save and stores that result, so a tampered or stale client can
 * never decide what an invoice is worth.
 *
 * The per-line math is NOT new arithmetic. It is
 * `purchasing/line-amounts.ts::computeLineAmounts`, already used by
 * Purchase Orders, Purchase Bills AND Sales Orders — `discount` is a
 * money amount off that line, and VAT is charged on what remains. Sales
 * Invoices were the one document in the system not using it.
 */

import { computeLineAmounts } from "@/server/purchasing/line-amounts";

/** The one rounding rule for this module — 2 decimals, half away from
 * zero for the non-negative amounts an invoice line can hold. Every
 * figure below is rounded exactly once, at the point it is produced;
 * nothing is rounded twice and no unrounded intermediate ever reaches a
 * stored column. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type InvoiceTotalsLineInput = {
  quantity: number;
  unitPrice: number;
  /** Money off this line, not a percentage — see the module docstring. */
  discount?: number;
  vatRatePercent: number;
};

export type InvoiceTotalsLine = {
  /** `quantity * unitPrice`, before discount — what the line would have
   * cost at list price. Shown on the document so a discount is visible
   * rather than silently baked into a smaller number. */
  grossAmount: number;
  discount: number;
  /** After discount, excluding VAT. This is what VAT is charged on. */
  netAmount: number;
  vatRatePercent: number;
  vatAmount: number;
  lineTotal: number;
};

export type InvoiceTotals = {
  lines: InvoiceTotalsLine[];
  /** Sum of line `netAmount` — i.e. already net of discount. */
  subtotal: number;
  discountTotal: number;
  vatAmount: number;
  total: number;
};

/** Which rate a line is charged at: its own `vatCode` when it names one,
 * otherwise the document's header VAT treatment. Returns `null` — never
 * throws, never silently substitutes — when a line names a code this
 * company does not have, so the server can refuse the save while the
 * client preview can just show the line as unpriced. */
export function resolveLineVatRatePercent(
  vatCode: string | null | undefined,
  headerVatRatePercent: number,
  ratesByCode: ReadonlyMap<string, number>,
): number | null {
  const code = vatCode?.trim();
  if (!code) return headerVatRatePercent;
  return ratesByCode.get(code) ?? null;
}

/**
 * Line amounts and document totals from already-resolved VAT rates.
 *
 * The reconciliation guarantee this buys, and which
 * `invoice-totals.test.ts` asserts directly: because each line's
 * `netAmount` and `vatAmount` are individually rounded to 2 decimals
 * before being summed, and the header figures are those sums,
 * `subtotal + vatAmount === total` and `sum(lineTotal) === total`
 * hold exactly — there is no rounding path by which the printed lines,
 * the stored header, and the posted journal can drift apart.
 */
export function computeInvoiceTotals(lines: InvoiceTotalsLineInput[]): InvoiceTotals {
  const computed: InvoiceTotalsLine[] = lines.map((line) => {
    const discount = line.discount ?? 0;
    const { netAmount, vatAmount, lineTotal } = computeLineAmounts(line.quantity, line.unitPrice, discount, line.vatRatePercent);
    return {
      grossAmount: round2(line.quantity * line.unitPrice),
      discount: round2(discount),
      netAmount,
      vatRatePercent: line.vatRatePercent,
      vatAmount,
      lineTotal,
    };
  });

  const subtotal = round2(computed.reduce((sum, l) => sum + l.netAmount, 0));
  const discountTotal = round2(computed.reduce((sum, l) => sum + l.discount, 0));
  const vatAmount = round2(computed.reduce((sum, l) => sum + l.vatAmount, 0));
  return { lines: computed, subtotal, discountTotal, vatAmount, total: round2(subtotal + vatAmount) };
}

export type InvoiceTotalsResult =
  | { ok: true; totals: InvoiceTotals }
  | { ok: false; unknownVatCode: string };

/**
 * The form the callers actually use: lines still carrying their raw
 * `vatCode`, resolved against this company's own `vat_treatments` and
 * falling back to the document's header treatment. Never throws — an
 * unrecognised code comes back as `{ ok: false }` so the service can
 * turn it into a 400 with the offending code named, exactly as it
 * already does for an unknown header treatment.
 */
export function computeInvoiceTotalsFromCodes(
  lines: { quantity: number; unitPrice: number; discount?: number; vatCode?: string | null }[],
  headerVatRatePercent: number,
  ratesByCode: ReadonlyMap<string, number>,
): InvoiceTotalsResult {
  const resolved: InvoiceTotalsLineInput[] = [];
  for (const line of lines) {
    const vatRatePercent = resolveLineVatRatePercent(line.vatCode, headerVatRatePercent, ratesByCode);
    if (vatRatePercent === null) return { ok: false, unknownVatCode: line.vatCode!.trim() };
    resolved.push({ quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, vatRatePercent });
  }
  return { ok: true, totals: computeInvoiceTotals(resolved) };
}
