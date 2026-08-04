import { describe, expect, it } from "vitest";
import { calculateProration } from "./billing-engine";

describe("calculateProration", () => {
  it("charges/credits proportionally for the days remaining in the period", () => {
    // 30-day period, change happens exactly halfway (15 days remaining).
    const result = calculateProration({
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-01-31T00:00:00.000Z",
      oldUnitAmount: 300,
      newUnitAmount: 600,
      changeDate: "2026-01-16T00:00:00.000Z",
    });
    expect(result.daysInPeriod).toBe(30);
    expect(result.daysRemaining).toBe(15);
    expect(result.unusedOldAmount).toBe(150); // 15/30 * 300
    expect(result.proratedNewAmount).toBe(300); // 15/30 * 600
    expect(result.netAmount).toBe(150); // charge the difference
  });

  it("a downgrade produces a negative net amount (a credit)", () => {
    const result = calculateProration({
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-01-31T00:00:00.000Z",
      oldUnitAmount: 600,
      newUnitAmount: 300,
      changeDate: "2026-01-16T00:00:00.000Z",
    });
    expect(result.netAmount).toBeLessThan(0);
  });

  it("no proration when the change lands on or after the period end", () => {
    const result = calculateProration({
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-01-31T00:00:00.000Z",
      oldUnitAmount: 300,
      newUnitAmount: 600,
      changeDate: "2026-01-31T00:00:00.000Z",
    });
    expect(result).toEqual({ daysInPeriod: 30, daysRemaining: 0, unusedOldAmount: 0, proratedNewAmount: 0, netAmount: 0 });
  });

  it("full-period change (day one) prorates the entire period amount", () => {
    const result = calculateProration({
      currentPeriodStart: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-01-31T00:00:00.000Z",
      oldUnitAmount: 300,
      newUnitAmount: 600,
      changeDate: "2026-01-01T00:00:00.000Z",
    });
    expect(result.daysRemaining).toBe(30);
    expect(result.unusedOldAmount).toBe(300);
    expect(result.proratedNewAmount).toBe(600);
  });
});
