import { describe, expect, it } from "vitest";
import {
  simulateAssetReplacement,
  simulateHiring,
  simulateOpexReduction,
  simulateReceiptDelay,
  simulateSalesIncrease,
  simulateSupplierPriceIncrease,
  type ScenarioIncomeBaseline,
} from "./scenario-engine";

function baseline(overrides: Partial<ScenarioIncomeBaseline> = {}): ScenarioIncomeBaseline {
  return { revenue: 100000, costOfSales: 40000, operatingExpenses: 15000, otherIncome: 0, otherExpense: 0, netProfit: 45000, ...overrides };
}

describe("simulateSalesIncrease", () => {
  it("scales cost of sales proportionally and leaves gross margin unchanged", () => {
    const impact = simulateSalesIncrease(baseline(), 10);
    expect(impact.profitabilityImpact).toBe(6000); // 10% of (revenue-cost) = 10% of 60000
    expect(impact.keyRatiosAffected[0].before).toBe(impact.keyRatiosAffected[0].after);
  });

  it("increases both cash flow and balance sheet impact by the revenue increase", () => {
    const impact = simulateSalesIncrease(baseline(), 10);
    expect(impact.cashFlowImpact).toBe(10000);
    expect(impact.balanceSheetImpact).toBe(10000);
  });
});

describe("simulateReceiptDelay", () => {
  it("has zero profitability impact — a pure timing effect", () => {
    const impact = simulateReceiptDelay(50000, 30, 1000);
    expect(impact.profitabilityImpact).toBe(0);
    expect(impact.cashFlowImpact).toBe(-30000);
  });
});

describe("simulateSupplierPriceIncrease", () => {
  it("reduces net profit by the exact cost increase", () => {
    const impact = simulateSupplierPriceIncrease(baseline(), 5);
    expect(impact.profitabilityImpact).toBe(-2000); // 5% of 40000
    expect(impact.cashFlowImpact).toBe(-2000);
  });
});

describe("simulateAssetReplacement", () => {
  it("reuses the real depreciation engine for the new asset's monthly amount", () => {
    // New asset: cost 120000, residual 12000, life 60 months -> 1800/month (matches depreciation-engine.test.ts)
    const impact = simulateAssetReplacement(20000, 500, 120000, 12000, 60);
    expect(impact.keyRatiosAffected[0].after).toBe(1800);
    expect(impact.profitabilityImpact).toBe(-1300); // -(1800 - 500)
  });

  it("treats the purchase as a full cash outflow", () => {
    const impact = simulateAssetReplacement(20000, 500, 120000, 12000, 60);
    expect(impact.cashFlowImpact).toBe(-120000);
  });
});

describe("simulateOpexReduction", () => {
  it("improves both profitability and cash by the same amount", () => {
    const impact = simulateOpexReduction(baseline(), 10);
    expect(impact.profitabilityImpact).toBe(1500);
    expect(impact.cashFlowImpact).toBe(1500);
  });
});

describe("simulateHiring", () => {
  it("discloses the lack of a real payroll module", () => {
    const impact = simulateHiring(600000);
    expect(impact.profitabilityImpact).toBe(-50000);
    expect(impact.assumptions.some((a) => a.includes("No Payroll module"))).toBe(true);
  });
});
