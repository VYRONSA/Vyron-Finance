import { describe, expect, it } from "vitest";
import { buildAssetDashboardSummary, computeAssetHealthScore } from "./asset-dashboard-summary-service";
import type { AssetFinding, FixedAsset } from "@/server/assets/types";

function fixedAsset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 1, companyId: "co_1", assetNumber: "FA000001", description: "Vehicle", assetClassId: null, category: "", assetGroup: "",
    purchaseDate: "2021-01-01", inServiceDate: "2021-01-01", cost: 120000, residualValue: 12000, usefulLifeMonths: 60,
    depreciationMethod: "StraightLine", diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, unitsOfProductionUnitsToDate: 0,
    accumulatedDepreciation: 30000, accumulatedImpairment: 0, supplierId: null, branchId: null, departmentId: null, costCentreId: null, projectId: null,
    location: "", custodian: "", status: "Active", statusChangedAt: "2021-01-01T00:00:00Z", serialNumber: "", warrantyExpiryDate: null,
    insuranceProvider: "", insurancePolicyNumber: "", insuranceExpiryDate: null, imageUrl: "", documentUrl: "", acquisitionJournalId: null,
    createdBy: "System", createdAt: "2021-01-01T00:00:00Z", updatedAt: "2021-01-01T00:00:00Z",
    ...overrides,
  };
}

function finding(overrides: Partial<AssetFinding> = {}): AssetFinding {
  return {
    id: 1, companyId: "co_1", assetId: 1, findingType: "WarrantyExpiry", confidence: 0.7, reason: "r", evidence: "e", suggestedAction: "a",
    status: "Open", resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildAssetDashboardSummary", () => {
  it("sums cost and net book value across active assets", () => {
    const summary = buildAssetDashboardSummary([fixedAsset(), fixedAsset({ id: 2, cost: 50000, accumulatedDepreciation: 10000 })], [], 0);
    expect(summary.totalAssetValue).toBe(170000);
    expect(summary.netBookValue).toBe(90000 + 40000);
  });

  it("excludes WrittenOff assets from totals", () => {
    const summary = buildAssetDashboardSummary([fixedAsset({ status: "WrittenOff" })], [], 0);
    expect(summary.totalAssetValue).toBe(0);
  });

  it("counts only Open findings toward each metric", () => {
    const findings = [finding({ findingType: "OverdueReplacement", status: "Open" }), finding({ id: 2, findingType: "OverdueReplacement", status: "Resolved" })];
    const summary = buildAssetDashboardSummary([fixedAsset()], findings, 0);
    expect(summary.assetsDueForReplacementCount).toBe(1);
  });

  it("passes through depreciationThisMonth unchanged", () => {
    const summary = buildAssetDashboardSummary([], [], 4500);
    expect(summary.depreciationThisMonth).toBe(4500);
  });
});

describe("computeAssetHealthScore", () => {
  it("is 100 with no open findings", () => {
    expect(computeAssetHealthScore([])).toBe(100);
  });

  it("deducts more for an Impairment Indicator than a High Value classification", () => {
    const withImpairment = computeAssetHealthScore([finding({ findingType: "ImpairmentIndicator" })]);
    const withHighValue = computeAssetHealthScore([finding({ findingType: "HighValueAsset" })]);
    expect(withImpairment).toBeLessThan(withHighValue);
  });

  it("never goes below 0", () => {
    const manyFindings = Array.from({ length: 50 }, (_, i) => finding({ id: i, findingType: "ImpairmentIndicator" }));
    expect(computeAssetHealthScore(manyFindings)).toBe(0);
  });
});
