import { describe, expect, it } from "vitest";
import { editAssetDetailsRequiresElevatedPermission } from "./asset-register-service";

describe("editAssetDetailsRequiresElevatedPermission", () => {
  it("requires elevated permission when useful life is present", () => {
    expect(editAssetDetailsRequiresElevatedPermission({ usefulLifeMonths: 36 })).toBe(true);
  });

  it("requires elevated permission when depreciation method is present", () => {
    expect(editAssetDetailsRequiresElevatedPermission({ depreciationMethod: "DiminishingBalance" })).toBe(true);
  });

  it("requires elevated permission when residual value is present, including zero", () => {
    expect(editAssetDetailsRequiresElevatedPermission({ residualValue: 0 })).toBe(true);
  });

  it("does not require elevated permission for descriptive fields", () => {
    expect(editAssetDetailsRequiresElevatedPermission({ description: "New description", category: "Vehicles", serialNumber: "ABC123" })).toBe(false);
  });

  it("does not require elevated permission for an empty edit", () => {
    expect(editAssetDetailsRequiresElevatedPermission({})).toBe(false);
  });
});
