import { describe, expect, it } from "vitest";
import { isLiveCountedUsageKey, isMeteredUsageKey } from "./usage-metering-engine";
import { LIVE_COUNTED_USAGE_KEYS, METERED_USAGE_KEYS, USAGE_METRIC_KEYS } from "../types";

describe("usage key classification", () => {
  it("every metered key is metered and not live-counted", () => {
    for (const key of METERED_USAGE_KEYS) {
      expect(isMeteredUsageKey(key)).toBe(true);
      expect(isLiveCountedUsageKey(key)).toBe(false);
    }
  });

  it("every live-counted key is live-counted and not metered", () => {
    for (const key of LIVE_COUNTED_USAGE_KEYS) {
      expect(isLiveCountedUsageKey(key)).toBe(true);
      expect(isMeteredUsageKey(key)).toBe(false);
    }
  });

  it("the two sets partition the full USAGE_METRIC_KEYS list exactly — no overlap, no gap", () => {
    expect(METERED_USAGE_KEYS.length + LIVE_COUNTED_USAGE_KEYS.length).toBe(USAGE_METRIC_KEYS.length);
    for (const key of USAGE_METRIC_KEYS) {
      expect(isMeteredUsageKey(key) !== isLiveCountedUsageKey(key)).toBe(true);
    }
  });
});
