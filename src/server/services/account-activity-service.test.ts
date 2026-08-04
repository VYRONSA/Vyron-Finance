import { describe, expect, it } from "vitest";
import { buildMonthlyTrend, computeVariance, shiftDateOneYearBack } from "./account-activity-service";

describe("buildMonthlyTrend", () => {
  it("buckets transactions by calendar month, sorted ascending", () => {
    const trend = buildMonthlyTrend([
      { postingDate: "2026-02-10", debit: 100, credit: 0 },
      { postingDate: "2026-01-05", debit: 0, credit: 50 },
      { postingDate: "2026-01-20", debit: 200, credit: 0 },
    ]);
    expect(trend).toEqual([
      { month: "2026-01", debit: 200, credit: 50, netMovement: 150 },
      { month: "2026-02", debit: 100, credit: 0, netMovement: 100 },
    ]);
  });

  it("returns an empty array for no transactions", () => {
    expect(buildMonthlyTrend([])).toEqual([]);
  });
});

describe("shiftDateOneYearBack", () => {
  it("shifts an ordinary date back one calendar year", () => {
    expect(shiftDateOneYearBack("2026-07-15")).toBe("2025-07-15");
  });

  it("clamps 29 Feb (leap year) into the target non-leap year at 28 Feb", () => {
    expect(shiftDateOneYearBack("2024-02-29")).toBe("2023-02-28");
  });
});

describe("computeVariance", () => {
  it("computes a positive variance and percent when current exceeds previous", () => {
    expect(computeVariance(1200, 1000)).toEqual({ variance: 200, variancePercent: 20 });
  });

  it("computes a negative variance when current is lower than previous", () => {
    expect(computeVariance(800, 1000)).toEqual({ variance: -200, variancePercent: -20 });
  });

  it("returns a null percent (not Infinity/NaN) when there was no prior-year movement", () => {
    expect(computeVariance(500, 0)).toEqual({ variance: 500, variancePercent: null });
  });
});
