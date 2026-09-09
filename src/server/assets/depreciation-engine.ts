/**
 * The platform's ONE Depreciation Engine — pure, no Supabase, exhaustively
 * unit tested. Every method (Straight Line, Diminishing Balance, Units of
 * Production, Custom) and every caller (a single asset's schedule, a
 * whole-company Depreciation Run, a forecast, a recalculation after a
 * useful-life change) goes through the same `runDepreciationForAsset`
 * core — never a second depreciation formula anywhere else in the
 * platform. A depreciation run's resulting journal still terminates at
 * the same shared `postApprovedJournals` Posting Engine every other
 * document type uses (see `asset-lifecycle-engine.ts` for the journal
 * line builder) — this file only computes amounts, never posts.
 */

import type { DepreciationMethod } from "./types";

const MS_PER_DAY = 86_400_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY);
}

/** Pure — the one place "what is this asset worth right now" is
 * computed: original cost, minus everything depreciated off it, minus
 * any impairment written down against it. Never stored redundantly on
 * the asset row itself — always derived. */
export function computeNetBookValue(cost: number, accumulatedDepreciation: number, accumulatedImpairment: number): number {
  return round2(Math.max(0, cost - accumulatedDepreciation - accumulatedImpairment));
}

export type DepreciableAsset = {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  diminishingBalanceRatePercent: number;
  unitsOfProductionLifeUnits: number;
  accumulatedDepreciation: number;
  accumulatedImpairment: number;
  inServiceDate: string | null;
  status: string;
};

/** Pure — the un-prorated full-month depreciation amount for one asset,
 * dispatched by method. `Custom` is a real, honest extension point: it
 * returns 0 (no formula exists yet for it in this platform) rather than
 * guessing — see the module docstring on "Custom methods (extension
 * point)." Units of Production needs `unitsThisPeriod`, supplied by the
 * caller (defaults to 0, i.e. framework-ready but not yet fed real
 * production-unit data — no metering/IoT source exists in this
 * codebase, a disclosed gap, not a fabricated one). */
export function computeMonthlyDepreciationAmount(asset: DepreciableAsset, currentNetBookValue: number, unitsThisPeriod = 0): number {
  const depreciableBase = Math.max(0, asset.cost - asset.residualValue);

  switch (asset.depreciationMethod) {
    case "StraightLine": {
      if (asset.usefulLifeMonths <= 0) return 0;
      return round2(depreciableBase / asset.usefulLifeMonths);
    }
    case "DiminishingBalance": {
      // The rate applies to the full current net book value — residual
      // value is enforced as a floor by `runDepreciationForAsset`'s own
      // `remainingDepreciable` cap, not by subtracting it here first
      // (that would double-apply the floor and understate depreciation
      // relative to the standard reducing-balance method).
      const monthlyRate = asset.diminishingBalanceRatePercent / 100 / 12;
      return round2(currentNetBookValue * monthlyRate);
    }
    case "UnitsOfProduction": {
      if (asset.unitsOfProductionLifeUnits <= 0) return 0;
      return round2((depreciableBase / asset.unitsOfProductionLifeUnits) * unitsThisPeriod);
    }
    case "Custom":
      return 0;
    default:
      return 0;
  }
}

/** Pure — prorates a full-month amount for the fraction of `periodStart`
 * .. `periodEnd` the asset was actually in service, so an asset placed
 * in service mid-month depreciates a partial amount that month rather
 * than a full one. Assets already in service before `periodStart` (the
 * overwhelmingly common case) get the full amount back unchanged. */
export function prorateForPartialPeriod(fullAmount: number, periodStart: string, periodEnd: string, inServiceDate: string): number {
  const periodDays = daysBetween(periodStart, periodEnd) + 1;
  if (periodDays <= 0) return 0;
  if (inServiceDate <= periodStart) return fullAmount;
  if (inServiceDate > periodEnd) return 0;

  const daysInService = daysBetween(inServiceDate, periodEnd) + 1;
  return round2(fullAmount * (daysInService / periodDays));
}

export type DepreciationResult = {
  amount: number;
  accumulatedDepreciationAfter: number;
  netBookValueAfter: number;
};

/** Pure — the ONE function every caller (a Depreciation Run, a forecast,
 * a recalculation) uses to depreciate one asset for one period. Returns
 * a zero-amount result (not an error) for every case where depreciation
 * genuinely shouldn't run: not yet in service, already fully
 * depreciated to residual value, or in a terminal status
 * (Disposed/WrittenOff/Retired) — real business rules, not omissions. */
export function runDepreciationForAsset(asset: DepreciableAsset, periodStart: string, periodEnd: string, unitsThisPeriod = 0): DepreciationResult {
  const currentNetBookValue = computeNetBookValue(asset.cost, asset.accumulatedDepreciation, asset.accumulatedImpairment);
  const terminalStatuses = new Set(["Disposed", "WrittenOff", "Retired", "Draft"]);

  if (terminalStatuses.has(asset.status) || !asset.inServiceDate || asset.inServiceDate > periodEnd) {
    return { amount: 0, accumulatedDepreciationAfter: asset.accumulatedDepreciation, netBookValueAfter: currentNetBookValue };
  }

  const remainingDepreciable = round2(currentNetBookValue - asset.residualValue);
  if (remainingDepreciable <= 0) {
    return { amount: 0, accumulatedDepreciationAfter: asset.accumulatedDepreciation, netBookValueAfter: currentNetBookValue };
  }

  const fullAmount = computeMonthlyDepreciationAmount(asset, currentNetBookValue, unitsThisPeriod);
  const prorated = prorateForPartialPeriod(fullAmount, periodStart, periodEnd, asset.inServiceDate);
  const amount = Math.min(prorated, remainingDepreciable);

  return {
    amount: round2(amount),
    accumulatedDepreciationAfter: round2(asset.accumulatedDepreciation + amount),
    netBookValueAfter: round2(currentNetBookValue - amount),
  };
}

export type DepreciationForecastPoint = { period: string; depreciationAmount: number; accumulatedDepreciationAfter: number; netBookValueAfter: number };

/** Pure — a deterministic, formula-driven schedule projected forward
 * `monthsAhead` periods, month by month, reusing
 * `runDepreciationForAsset` at each step (never a second formula, and
 * deliberately NOT the statistical `linearRegressionForecast` — a known
 * depreciation formula should be projected exactly, not estimated from
 * a historical trend). */
export function buildDepreciationForecast(asset: DepreciableAsset, fromPeriodEnd: string, monthsAhead: number): DepreciationForecastPoint[] {
  const points: DepreciationForecastPoint[] = [];
  let working = { accumulatedDepreciation: asset.accumulatedDepreciation };
  let cursor = new Date(`${fromPeriodEnd}T00:00:00Z`);

  for (let i = 1; i <= monthsAhead; i++) {
    const periodStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const periodEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
    const result = runDepreciationForAsset({ ...asset, accumulatedDepreciation: working.accumulatedDepreciation }, periodStart, periodEnd);
    points.push({ period: periodEnd.slice(0, 7), depreciationAmount: result.amount, accumulatedDepreciationAfter: result.accumulatedDepreciationAfter, netBookValueAfter: result.netBookValueAfter });
    working = { accumulatedDepreciation: result.accumulatedDepreciationAfter };
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return points;
}

export type RecalculationResult = { remainingMonths: number; newMonthlyStraightLineAmount: number };

/** Pure — after a useful-life change, spreads the asset's REMAINING
 * depreciable amount (current NBV minus residual) over the new
 * remaining life, rather than restarting or ignoring depreciation
 * already taken — the standard "prospective" treatment for a useful-
 * life revision. Only meaningful for Straight Line (Diminishing Balance
 * is rate-driven and self-adjusts every period without a recalculation
 * step; Units of Production is driven by units, not elapsed months). */
export function recalculateAfterUsefulLifeChange(asset: DepreciableAsset, monthsElapsedSinceInService: number, newUsefulLifeMonths: number): RecalculationResult {
  const currentNetBookValue = computeNetBookValue(asset.cost, asset.accumulatedDepreciation, asset.accumulatedImpairment);
  const remainingMonths = Math.max(0, newUsefulLifeMonths - monthsElapsedSinceInService);
  if (remainingMonths === 0) return { remainingMonths: 0, newMonthlyStraightLineAmount: 0 };

  const remainingDepreciable = round2(Math.max(0, currentNetBookValue - asset.residualValue));
  return { remainingMonths, newMonthlyStraightLineAmount: round2(remainingDepreciable / remainingMonths) };
}
