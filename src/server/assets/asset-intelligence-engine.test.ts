import { describe, expect, it } from "vitest";
import {
  buildAssetIntelligence,
  detectCapitalisationAnomaly,
  detectHighMaintenanceRisk,
  detectHighValueAsset,
  detectIdleAsset,
  detectImpairmentIndicator,
  detectInsuranceExpiry,
  detectOverdueReplacement,
  detectUnderutilisation,
  detectUnusualDepreciation,
  detectWarrantyExpiry,
  type AssetSnapshot,
} from "./asset-intelligence-engine";

function asset(overrides: Partial<AssetSnapshot> = {}): AssetSnapshot {
  return {
    id: 1,
    assetNumber: "FA000001",
    description: "Delivery Vehicle",
    cost: 120000,
    residualValue: 12000,
    usefulLifeMonths: 60,
    depreciationMethod: "StraightLine",
    diminishingBalanceRatePercent: 20,
    unitsOfProductionLifeUnits: 0,
    accumulatedDepreciation: 0,
    accumulatedImpairment: 0,
    inServiceDate: "2021-01-01",
    status: "Active",
    statusChangedAt: "2021-01-01T00:00:00Z",
    warrantyExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  };
}

describe("detectOverdueReplacement", () => {
  it("flags an Active asset past its planned end of life", () => {
    const finding = detectOverdueReplacement(asset({ inServiceDate: "2020-01-01", usefulLifeMonths: 12 }), "2026-01-01");
    expect(finding?.findingType).toBe("OverdueReplacement");
  });

  it("does not flag an asset still within its useful life", () => {
    expect(detectOverdueReplacement(asset(), "2022-01-01")).toBeNull();
  });

  it("does not flag a non-Active asset", () => {
    expect(detectOverdueReplacement(asset({ inServiceDate: "2020-01-01", usefulLifeMonths: 12, status: "Disposed" }), "2026-01-01")).toBeNull();
  });
});

describe("detectUnderutilisation vs detectIdleAsset — same data source, two severities", () => {
  it("flags Underutilisation for a 45-day idle asset but not Idle Asset", () => {
    const idleAsset = asset({ status: "Idle", statusChangedAt: "2026-01-01T00:00:00Z" });
    expect(detectUnderutilisation(idleAsset, "2026-02-15")).not.toBeNull(); // 45 days
    expect(detectIdleAsset(idleAsset, "2026-02-15")).toBeNull();
  });

  it("flags Idle Asset but not Underutilisation past 90 days", () => {
    const idleAsset = asset({ status: "Idle", statusChangedAt: "2026-01-01T00:00:00Z" });
    expect(detectIdleAsset(idleAsset, "2026-06-01")).not.toBeNull(); // >90 days
    expect(detectUnderutilisation(idleAsset, "2026-06-01")).toBeNull();
  });

  it("flags neither for an asset idle less than 30 days", () => {
    const idleAsset = asset({ status: "Idle", statusChangedAt: "2026-01-01T00:00:00Z" });
    expect(detectUnderutilisation(idleAsset, "2026-01-10")).toBeNull();
    expect(detectIdleAsset(idleAsset, "2026-01-10")).toBeNull();
  });
});

describe("detectHighMaintenanceRisk", () => {
  it("flags an asset stuck Under Maintenance for 14+ days", () => {
    const finding = detectHighMaintenanceRisk(asset({ status: "UnderMaintenance", statusChangedAt: "2026-01-01T00:00:00Z" }), "2026-01-20");
    expect(finding?.findingType).toBe("HighMaintenanceRisk");
  });

  it("does not flag a freshly-started maintenance period", () => {
    expect(detectHighMaintenanceRisk(asset({ status: "UnderMaintenance", statusChangedAt: "2026-01-01T00:00:00Z" }), "2026-01-05")).toBeNull();
  });
});

describe("detectWarrantyExpiry / detectInsuranceExpiry", () => {
  it("flags an upcoming warranty expiry within the window", () => {
    const finding = detectWarrantyExpiry(asset({ warrantyExpiryDate: "2026-02-01" }), "2026-01-15", 60);
    expect(finding?.reason).toContain("expires in");
  });

  it("flags an already-expired warranty with higher confidence", () => {
    const finding = detectWarrantyExpiry(asset({ warrantyExpiryDate: "2026-01-01" }), "2026-01-15", 60);
    expect(finding?.reason).toContain("expired");
    expect(finding?.confidence).toBe(0.9);
  });

  it("does not flag a warranty far in the future", () => {
    expect(detectWarrantyExpiry(asset({ warrantyExpiryDate: "2027-01-01" }), "2026-01-15", 60)).toBeNull();
  });

  it("flags insurance expiry with a higher confidence than warranty when already past", () => {
    const finding = detectInsuranceExpiry(asset({ insuranceExpiryDate: "2026-01-01" }), "2026-01-15", 60);
    expect(finding?.confidence).toBe(0.95);
  });
});

describe("detectUnusualDepreciation", () => {
  it("flags a material deviation from the engine-expected amount", () => {
    const finding = detectUnusualDepreciation(asset(), 1000, 1800);
    expect(finding?.findingType).toBe("UnusualDepreciation");
  });

  it("does not flag a small, tolerance-band deviation", () => {
    expect(detectUnusualDepreciation(asset(), 1795, 1800)).toBeNull();
  });
});

describe("detectImpairmentIndicator", () => {
  it("flags an Active, not-fully-depreciated asset with no recent depreciation posted", () => {
    const finding = detectImpairmentIndicator(asset(), "2026-01-01", [0, 0]);
    expect(finding?.findingType).toBe("ImpairmentIndicator");
  });

  it("does not flag an asset that IS depreciating normally", () => {
    expect(detectImpairmentIndicator(asset(), "2026-01-01", [1800, 1800])).toBeNull();
  });

  it("does not flag an already fully-depreciated asset", () => {
    expect(detectImpairmentIndicator(asset({ accumulatedDepreciation: 108000 }), "2026-01-01", [0, 0])).toBeNull();
  });
});

describe("detectHighValueAsset / detectCapitalisationAnomaly", () => {
  it("flags an asset at or above the high-value threshold", () => {
    expect(detectHighValueAsset(asset({ cost: 150000 }), 100000)).not.toBeNull();
    expect(detectHighValueAsset(asset({ cost: 50000 }), 100000)).toBeNull();
  });

  it("flags a capitalised asset below the capitalisation threshold", () => {
    expect(detectCapitalisationAnomaly(asset({ cost: 3000, status: "Active" }), 7000)).not.toBeNull();
    expect(detectCapitalisationAnomaly(asset({ cost: 10000, status: "Active" }), 7000)).toBeNull();
  });

  it("does not flag a Draft asset below threshold — it hasn't been capitalised yet", () => {
    expect(detectCapitalisationAnomaly(asset({ cost: 3000, status: "Draft" }), 7000)).toBeNull();
  });
});

describe("buildAssetIntelligence", () => {
  it("composes multiple real findings for one asset", () => {
    const findings = buildAssetIntelligence(
      asset({ cost: 150000, warrantyExpiryDate: "2026-01-20" }),
      { todayIso: "2026-01-15", highValueThreshold: 100000, capitalisationThreshold: 7000, warrantyWindowDays: 60 },
    );
    expect(findings.some((f) => f.findingType === "HighValueAsset")).toBe(true);
    expect(findings.some((f) => f.findingType === "WarrantyExpiry")).toBe(true);
  });

  it("returns an empty array for a clean, unremarkable asset", () => {
    const findings = buildAssetIntelligence(asset(), { todayIso: "2022-06-01", highValueThreshold: 1_000_000, capitalisationThreshold: 7000 });
    expect(findings).toHaveLength(0);
  });
});
