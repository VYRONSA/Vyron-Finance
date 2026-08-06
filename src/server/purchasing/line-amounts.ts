/**
 * Pure net/VAT/total math for one captured line item — shared by
 * Purchase Orders and Bills/Credit Notes/Debit Notes (both multi-line
 * capture screens the Product Review Board required carry the identical
 * GL/VAT/cost-centre/project/department/quantity/unit-cost/discount
 * shape). Lives here, not in either service, the same reason
 * `amount-split.ts::splitGrossAmount` lives on its own — one place for
 * math two independent modules both need, no cross-service import.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type LineAmounts = { netAmount: number; vatAmount: number; lineTotal: number };

/** `quantity * unitCost - discount`, then VAT at `vatRatePercent` on the
 * net. A `vatRatePercent` of 0 (no VAT code selected yet) collapses
 * `lineTotal` to exactly `netAmount` — the same figure this arithmetic
 * has always produced before VAT-per-line existed, not a special case. */
export function computeLineAmounts(quantity: number, unitCost: number, discount: number, vatRatePercent: number): LineAmounts {
  const netAmount = round2(quantity * unitCost - discount);
  const vatAmount = round2(netAmount * (vatRatePercent / 100));
  return { netAmount, vatAmount, lineTotal: round2(netAmount + vatAmount) };
}
