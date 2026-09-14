import { describe, expect, it } from "vitest";
import { formatAmount } from "@/lib/format";
import { totalBalanceLabel } from "./page";

// Master Implementation Tracker — Programme 2, Root Cause RC-13, Finding
// #018. Amounts use VYRON's deterministic accounting format
// (`src/lib/format.ts`) — identical on the server and in every browser.
function fmt(value: number): string {
  return formatAmount(value);
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
