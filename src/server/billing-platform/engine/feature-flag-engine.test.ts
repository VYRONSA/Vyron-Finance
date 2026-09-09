import { describe, expect, it } from "vitest";
import { resolveFeatureFlag } from "./feature-flag-engine";

describe("resolveFeatureFlag", () => {
  it("uses the plan default when there is no override", () => {
    expect(resolveFeatureFlag(true, undefined)).toBe(true);
    expect(resolveFeatureFlag(false, undefined)).toBe(false);
  });

  it("an override always wins over the plan default, in both directions", () => {
    expect(resolveFeatureFlag(false, true)).toBe(true);
    expect(resolveFeatureFlag(true, false)).toBe(false);
  });
});
