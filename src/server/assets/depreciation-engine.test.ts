import { describe, expect, it } from "vitest";
import {
  buildDepreciationForecast,
  computeMonthlyDepreciationAmount,
  computeNetBookValue,
  prorateForPartialPeriod,
  recalculateAfterUsefulLifeChange,
  runDepreciationForAsset,
  type DepreciableAsset,
} from "./depreciation-engine";

function asset(overrides: Partial<DepreciableAsset> = {}): DepreciableAsset {
  return {
    cost: 120000,
    residualValue: 12000,
    usefulLifeMonths: 60,
    depreciationMethod: "StraightLine",
    diminishingBalanceRatePercent: 20,
    unitsOfProductionLifeUnits: 0,
    accumulatedDepreciation: 0,
    accumulatedImpairment: 0,
    inServiceDate: "2025-01-01",
    status: "Active",
    ...overrides,
  };
}

describe("computeNetBookValue", () => {
  it("subtracts accumulated depreciation and impairment from cost", () => {
    expect(computeNetBookValue(120000, 30000, 5000)).toBe(85000);
  });

  it("never goes negative", () => {
    expect(computeNetBookValue(1000, 900, 900)).toBe(0);
  });
});

describe("computeMonthlyDepreciationAmount", () => {
  it("computes Straight Line: (cost - residual) / life", () => {
    expect(computeMonthlyDepreciationAmount(asset(), 120000)).toBe(1800);
  });

  it("computes Diminishing Balance: NBV * annual rate / 12", () => {
    const a = asset({ depreciationMethod: "DiminishingBalance", diminishingBalanceRatePercent: 20 });
    expect(computeMonthlyDepreciationAmount(a, 100000)).toBe(1666.67);
  });

  it("computes Units of Production proportionally to units this period", () => {
    const a = asset({ depreciationMethod: "UnitsOfProduction", cost: 50000, residualValue: 5000, unitsOfProductionLifeUnits: 100000 });
    expect(computeMonthlyDepreciationAmount(a, 50000, 1000)).toBe(450);
  });

  it("returns 0 for Custom — a real, honest extension point, not a guess", () => {
    expect(computeMonthlyDepreciationAmount(asset({ depreciationMethod: "Custom" }), 100000)).toBe(0);
  });
});

describe("prorateForPartialPeriod", () => {
  it("returns the full amount when the asset was already in service before the period", () => {
    expect(prorateForPartialPeriod(1800, "2026-01-01", "2026-01-31", "2025-06-01")).toBe(1800);
  });

  it("prorates by days in service when placed in service mid-period", () => {
    expect(prorateForPartialPeriod(1800, "2026-01-01", "2026-01-31", "2026-01-16")).toBe(929.03);
  });

  it("returns 0 when the asset entered service after the period ended", () => {
    expect(prorateForPartialPeriod(1800, "2026-01-01", "2026-01-31", "2026-02-01")).toBe(0);
  });
});

describe("runDepreciationForAsset", () => {
  it("depreciates a normal in-service asset for a full month", () => {
    const result = runDepreciationForAsset(asset(), "2026-01-01", "2026-01-31");
    expect(result.amount).toBe(1800);
    expect(result.accumulatedDepreciationAfter).toBe(1800);
    expect(result.netBookValueAfter).toBe(118200);
  });

  it("returns 0 for an asset not yet in service", () => {
    const result = runDepreciationForAsset(asset({ inServiceDate: null }), "2026-01-01", "2026-01-31");
    expect(result.amount).toBe(0);
  });

  it("returns 0 for a Draft asset even with an in-service date", () => {
    const result = runDepreciationForAsset(asset({ status: "Draft" }), "2026-01-01", "2026-01-31");
    expect(result.amount).toBe(0);
  });

  it("returns 0 for a Disposed asset", () => {
    const result = runDepreciationForAsset(asset({ status: "Disposed" }), "2026-01-01", "2026-01-31");
    expect(result.amount).toBe(0);
  });

  it("stops at the residual value — never depreciates below it", () => {
    const nearlyDone = asset({ accumulatedDepreciation: 107500 }); // NBV = 12500, only 500 depreciable left
    const result = runDepreciationForAsset(nearlyDone, "2026-01-01", "2026-01-31");
    expect(result.amount).toBe(500);
    expect(result.netBookValueAfter).toBe(12000);
  });

  it("returns 0 once fully depreciated to residual value", () => {
    const done = asset({ accumulatedDepreciation: 108000 }); // NBV = 12000 = residual
    const result = runDepreciationForAsset(done, "2026-01-01", "2026-01-31");
    expect(result.amount).toBe(0);
  });
});

describe("buildDepreciationForecast", () => {
  it("projects a deterministic, monotonically increasing accumulated depreciation schedule", () => {
    const points = buildDepreciationForecast(asset(), "2025-12-31", 3);
    expect(points).toHaveLength(3);
    expect(points[0].depreciationAmount).toBe(1800);
    expect(points[2].accumulatedDepreciationAfter).toBe(5400);
    expect(points[2].netBookValueAfter).toBe(114600);
  });
});

describe("recalculateAfterUsefulLifeChange", () => {
  it("spreads the remaining depreciable amount over the new remaining life", () => {
    const a = asset({ accumulatedDepreciation: 18000 }); // 10 months elapsed at 1800/month
    const result = recalculateAfterUsefulLifeChange(a, 10, 100); // extend life to 100 months
    expect(result.remainingMonths).toBe(90);
    // NBV = 120000-18000=102000; depreciable remaining = 102000-12000=90000; /90 = 1000
    expect(result.newMonthlyStraightLineAmount).toBe(1000);
  });

  it("returns 0 remaining months when the new useful life has already elapsed", () => {
    const result = recalculateAfterUsefulLifeChange(asset(), 60, 48);
    expect(result.remainingMonths).toBe(0);
    expect(result.newMonthlyStraightLineAmount).toBe(0);
  });
});
