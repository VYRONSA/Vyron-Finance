/**
 * The What-If Scenario Engine — pure, no Supabase, no side effects.
 * "Scenarios must be isolated and never modify live accounting data" —
 * every function here takes real baseline figures already fetched from
 * `financial-statements-service.ts` and returns a projected impact;
 * nothing here writes to `gl_transactions`, `fixed_assets`, or any other
 * live table (the service layer only ever persists the scenario's
 * INPUT and OUTPUT to `copilot_scenarios`, never touches live data).
 * `simulateAssetReplacement` reuses `depreciation-engine.ts`'s own
 * `computeMonthlyDepreciationAmount` rather than a second depreciation
 * formula — "One Pure Calculation Library."
 */

import { computeMonthlyDepreciationAmount } from "@/server/assets/depreciation-engine";

export type KeyRatio = { ratio: string; before: number | null; after: number | null };

export type ScenarioImpact = {
  financialImpactSummary: string;
  cashFlowImpact: number;
  profitabilityImpact: number;
  balanceSheetImpact: number;
  keyRatiosAffected: KeyRatio[];
  assumptions: string[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function marginPercent(numerator: number, denominator: number): number | null {
  return denominator !== 0 ? round2((numerator / denominator) * 100) : null;
}

export type ScenarioIncomeBaseline = { revenue: number; costOfSales: number; operatingExpenses: number; otherIncome: number; otherExpense: number; netProfit: number };

/** Increase Sales by X% — assumes Cost of Sales scales proportionally
 * with revenue (a variable-cost assumption) and Operating Expenses stay
 * fixed; assumes the additional revenue is collected in the same period
 * (a simplification, disclosed) so it flows through as both a cash and
 * a debtors impact. */
export function simulateSalesIncrease(baseline: ScenarioIncomeBaseline, percentIncrease: number): ScenarioImpact {
  const revenueIncrease = round2(baseline.revenue * (percentIncrease / 100));
  const newRevenue = round2(baseline.revenue + revenueIncrease);
  const costRatio = baseline.revenue !== 0 ? baseline.costOfSales / baseline.revenue : 0;
  const newCostOfSales = round2(newRevenue * costRatio);
  const newGrossProfit = round2(newRevenue - newCostOfSales);
  const newNetProfit = round2(newGrossProfit - baseline.operatingExpenses + baseline.otherIncome - baseline.otherExpense);
  const profitabilityImpact = round2(newNetProfit - baseline.netProfit);

  return {
    financialImpactSummary: `A ${percentIncrease}% sales increase raises revenue by ${revenueIncrease}, improving Net Profit by ${profitabilityImpact}.`,
    cashFlowImpact: revenueIncrease,
    profitabilityImpact,
    balanceSheetImpact: revenueIncrease,
    keyRatiosAffected: [
      { ratio: "Gross Margin %", before: marginPercent(baseline.revenue - baseline.costOfSales, baseline.revenue), after: marginPercent(newGrossProfit, newRevenue) },
      { ratio: "Net Margin %", before: marginPercent(baseline.netProfit, baseline.revenue), after: marginPercent(newNetProfit, newRevenue) },
    ],
    assumptions: [
      "Cost of Sales scales proportionally with revenue (variable-cost assumption) — gross margin % is unchanged under this model.",
      "Operating Expenses are assumed fixed and do not scale with the additional revenue.",
      "The additional revenue is assumed collected in the same period, affecting both cash and debtors by the same amount — a simplification of real collection timing.",
    ],
  };
}

/** Delay Customer Receipts by N days — a pure timing effect: it does not
 * change Net Profit or the total debtors balance, only when the cash
 * arrives, modeled as a temporary cash shortfall of average daily
 * receipts x delay days. */
export function simulateReceiptDelay(currentCashPosition: number, delayDays: number, averageDailyReceipts: number): ScenarioImpact {
  const cashFlowImpact = round2(-averageDailyReceipts * delayDays);
  const projectedCash = round2(currentCashPosition + cashFlowImpact);

  return {
    financialImpactSummary: `Delaying customer receipts by ${delayDays} day(s) temporarily reduces cash on hand by ${Math.abs(cashFlowImpact)} — it does not change Net Profit.`,
    cashFlowImpact,
    profitabilityImpact: 0,
    balanceSheetImpact: 0,
    keyRatiosAffected: [{ ratio: "Cash Position", before: currentCashPosition, after: projectedCash }],
    assumptions: [
      "Assumes receipts resume at the same average daily rate after the delay — this models a temporary timing shift, not a permanent loss of revenue.",
      "Debtors' total balance is unchanged; only the timing of collection shifts.",
    ],
  };
}

/** Increase Supplier Prices by X% — assumes the increase applies to the
 * full Cost of Sales base and is paid in the same period. */
export function simulateSupplierPriceIncrease(baseline: ScenarioIncomeBaseline, percentIncrease: number): ScenarioImpact {
  const costIncrease = round2(baseline.costOfSales * (percentIncrease / 100));
  const newCostOfSales = round2(baseline.costOfSales + costIncrease);
  const newGrossProfit = round2(baseline.revenue - newCostOfSales);

  return {
    financialImpactSummary: `A ${percentIncrease}% supplier price increase raises Cost of Sales by ${costIncrease}, reducing Net Profit by the same amount.`,
    cashFlowImpact: -costIncrease,
    profitabilityImpact: -costIncrease,
    balanceSheetImpact: 0,
    keyRatiosAffected: [{ ratio: "Gross Margin %", before: marginPercent(baseline.revenue - baseline.costOfSales, baseline.revenue), after: marginPercent(newGrossProfit, baseline.revenue) }],
    assumptions: ["Assumes the price increase applies to the full Cost of Sales base and is paid in the same period (no payment-terms delay modeled).", "Assumes sales volume is unchanged — no demand response to cost pass-through is modeled."],
  };
}

/** Replace a Fixed Asset — reuses `depreciation-engine.ts`'s own
 * Straight Line formula for the new asset's monthly depreciation, never
 * a second formula. Assumes no trade-in value is received for the old
 * asset (a disclosed simplification — proceeds would need to be a real
 * Disposal event in the Fixed Assets workspace, not modeled here). */
export function simulateAssetReplacement(oldAssetNetBookValue: number, oldAssetMonthlyDepreciation: number, newAssetCost: number, newAssetResidualValue: number, newAssetUsefulLifeMonths: number): ScenarioImpact {
  const newMonthlyDepreciation = computeMonthlyDepreciationAmount(
    { cost: newAssetCost, residualValue: newAssetResidualValue, usefulLifeMonths: newAssetUsefulLifeMonths, depreciationMethod: "StraightLine", diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, accumulatedDepreciation: 0, accumulatedImpairment: 0, inServiceDate: null, status: "Active" },
    newAssetCost,
  );
  const depreciationDelta = round2(newMonthlyDepreciation - oldAssetMonthlyDepreciation);

  return {
    financialImpactSummary: `Replacing the asset increases monthly depreciation by ${depreciationDelta}, reducing Net Profit by the same amount each month; the purchase itself is a ${newAssetCost} cash outflow.`,
    cashFlowImpact: round2(-newAssetCost),
    profitabilityImpact: round2(-depreciationDelta),
    balanceSheetImpact: round2(newAssetCost - oldAssetNetBookValue),
    keyRatiosAffected: [{ ratio: "Monthly Depreciation Expense", before: oldAssetMonthlyDepreciation, after: newMonthlyDepreciation }],
    assumptions: [
      "Assumes no trade-in value is received for the old asset (a real Disposal, with any proceeds, would need to be recorded separately in the Fixed Assets workspace).",
      "New asset depreciation uses the Straight Line method via the same engine every real asset uses — reuse, not a new formula.",
      "The purchase is assumed to be a full cash payment, not financed.",
    ],
  };
}

/** Reduce Operating Expenses by X% — a direct, same-period profitability
 * and cash improvement. */
export function simulateOpexReduction(baseline: ScenarioIncomeBaseline, percentReduction: number): ScenarioImpact {
  const reduction = round2(baseline.operatingExpenses * (percentReduction / 100));
  const newOpex = round2(baseline.operatingExpenses - reduction);
  const newNetProfit = round2(baseline.netProfit + reduction);

  return {
    financialImpactSummary: `Reducing Operating Expenses by ${percentReduction}% saves ${reduction}, improving Net Profit by the same amount.`,
    cashFlowImpact: reduction,
    profitabilityImpact: reduction,
    balanceSheetImpact: 0,
    keyRatiosAffected: [{ ratio: "Net Margin %", before: marginPercent(baseline.netProfit, baseline.revenue), after: marginPercent(newNetProfit, baseline.revenue) }],
    assumptions: ["Assumes the entire reduction is a genuine cash saving in the same period, not a deferral.", `New Operating Expenses: ${newOpex}.`],
  };
}

/** Hire Additional Staff — "future payroll integration" per the
 * Product Review Board's own words: no Payroll module exists yet, so
 * this is a disclosed, honest proxy (a flat monthly salary-cost increase
 * to Operating Expenses), not a real payroll calculation. */
export function simulateHiring(annualSalaryCost: number): ScenarioImpact {
  const monthlyCost = round2(annualSalaryCost / 12);
  return {
    financialImpactSummary: `Hiring at an annual cost of ${annualSalaryCost} adds ${monthlyCost} to monthly Operating Expenses, reducing Net Profit by the same amount each month.`,
    cashFlowImpact: -monthlyCost,
    profitabilityImpact: -monthlyCost,
    balanceSheetImpact: 0,
    keyRatiosAffected: [],
    assumptions: [
      "No Payroll module exists in this platform yet (a disclosed future roadmap item) — this is a flat monthly salary-cost proxy, not a real payroll calculation.",
      "Tax, benefits, leave accruals, and other real payroll costs are NOT modeled here.",
    ],
  };
}
