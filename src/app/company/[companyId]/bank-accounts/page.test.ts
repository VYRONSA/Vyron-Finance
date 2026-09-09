import { describe, expect, it } from "vitest";
import { totalBalanceLabel } from "./page";

// Master Implementation Tracker — Programme 2, Root Cause RC-13, Finding
// #018. Number punctuation is locale-dependent (`toLocaleString(undefined, ...)`)
// — assert on the currency-grouping behavior, not exact separator characters.
function fmt(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

describe("totalBalanceLabel", () => {
  it("shows a single figure when every account shares one currency", () => {
    expect(totalBalanceLabel([{ currentBalance: 1000, currency: "ZAR" }, { currentBalance: 500, currency: "ZAR" }])).toBe(`ZAR ${fmt(1500)}`);
  });

  it("shows a per-currency breakdown instead of a meaningless cross-currency sum", () => {
    const result = totalBalanceLabel([{ currentBalance: 1000, currency: "ZAR" }, { currentBalance: 200, currency: "USD" }]);
    expect(result).toBe(`ZAR ${fmt(1000)} + USD ${fmt(200)}`);
  });

  it("defaults to ZAR 0.00 with no accounts", () => {
    expect(totalBalanceLabel([])).toBe(`ZAR ${fmt(0)}`);
  });
});
