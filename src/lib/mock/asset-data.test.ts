import { describe, expect, it } from "vitest";
import { MOCK_ASSET_FINDINGS, MOCK_DEPRECIATION_RUNS, MOCK_DEPRECIATION_RUN_LINES, MOCK_FIXED_ASSETS } from "./asset-data";

describe("asset-data mock fixed assets", () => {
  it("derives real, positive accumulated depreciation for in-service straight-line/diminishing-balance assets", () => {
    const vehicle = MOCK_FIXED_ASSETS.find((a) => a.assetNumber === "FA000001")!;
    expect(vehicle.accumulatedDepreciation).toBeGreaterThan(0);
    expect(vehicle.accumulatedDepreciation).toBeLessThanOrEqual(vehicle.cost - vehicle.residualValue);
  });

  it("never depreciates an asset below its residual value", () => {
    for (const asset of MOCK_FIXED_ASSETS) {
      expect(asset.accumulatedDepreciation).toBeLessThanOrEqual(asset.cost - asset.residualValue + 0.01);
    }
  });
});

describe("asset-data mock depreciation run", () => {
  it("totals the sum of its own lines", () => {
    const lineTotal = Math.round(MOCK_DEPRECIATION_RUN_LINES.reduce((sum, l) => sum + l.depreciationAmount, 0) * 100) / 100;
    expect(MOCK_DEPRECIATION_RUNS[0].totalAmount).toBe(lineTotal);
  });
});

describe("asset-data mock findings", () => {
  it("derives real findings from the Asset Intelligence engine (overdue forklift, idle printer)", () => {
    expect(MOCK_ASSET_FINDINGS.some((f) => f.findingType === "OverdueReplacement")).toBe(true);
    expect(MOCK_ASSET_FINDINGS.some((f) => f.findingType === "IdleAsset" || f.findingType === "CapitalisationAnomaly")).toBe(true);
  });

  it("gives every finding a unique id", () => {
    const ids = MOCK_ASSET_FINDINGS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
