import { describe, expect, it } from "vitest";
import { checkOccurrenceDue, computeNextRunDate } from "./recurrence";
import type { RecurrenceRule } from "./recurrence";

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { frequency: "Monthly", intervalCount: 1, skipWeekends: false, publicHolidays: [], ...overrides };
}

describe("computeNextRunDate", () => {
  it("adds one day for Daily", () => {
    expect(computeNextRunDate("2026-06-01", rule({ frequency: "Daily" }))).toBe("2026-06-02");
  });

  it("adds seven days for Weekly", () => {
    expect(computeNextRunDate("2026-06-01", rule({ frequency: "Weekly" }))).toBe("2026-06-08");
  });

  it("adds one calendar month for Monthly", () => {
    expect(computeNextRunDate("2026-06-15", rule({ frequency: "Monthly" }))).toBe("2026-07-15");
  });

  it("clamps day-of-month overflow for Monthly (Jan 31 -> Feb 28)", () => {
    expect(computeNextRunDate("2026-01-31", rule({ frequency: "Monthly" }))).toBe("2026-02-28");
  });

  it("clamps for a leap year February", () => {
    expect(computeNextRunDate("2028-01-31", rule({ frequency: "Monthly" }))).toBe("2028-02-29");
  });

  it("adds three calendar months for Quarterly", () => {
    expect(computeNextRunDate("2026-01-31", rule({ frequency: "Quarterly" }))).toBe("2026-04-30");
  });

  it("adds twelve calendar months for Annually", () => {
    expect(computeNextRunDate("2026-02-28", rule({ frequency: "Annually" }))).toBe("2027-02-28");
  });

  it("adds intervalCount days for Custom, minimum 1", () => {
    expect(computeNextRunDate("2026-06-01", rule({ frequency: "Custom", intervalCount: 10 }))).toBe("2026-06-11");
    expect(computeNextRunDate("2026-06-01", rule({ frequency: "Custom", intervalCount: 0 }))).toBe("2026-06-02");
  });

  it("rolls a weekend occurrence forward to Monday when skipWeekends is set", () => {
    // 2026-06-06 is a Saturday.
    expect(computeNextRunDate("2026-05-30", rule({ frequency: "Weekly", skipWeekends: true }))).toBe("2026-06-08");
  });

  it("does not roll forward when skipWeekends is false", () => {
    expect(computeNextRunDate("2026-05-30", rule({ frequency: "Weekly", skipWeekends: false }))).toBe("2026-06-06");
  });

  it("rolls forward past a listed public holiday", () => {
    expect(computeNextRunDate("2026-06-01", rule({ frequency: "Daily", publicHolidays: ["2026-06-02"] }))).toBe("2026-06-03");
  });

  it("rolls forward past consecutive weekend and holiday days", () => {
    // Land on a Saturday that's also (hypothetically) followed by a
    // holiday Monday — both should be skipped.
    expect(
      computeNextRunDate("2026-05-30", rule({ frequency: "Weekly", skipWeekends: true, publicHolidays: ["2026-06-08"] })),
    ).toBe("2026-06-09");
  });
});

describe("checkOccurrenceDue", () => {
  it("is due when the candidate date has arrived and no limits apply", () => {
    const result = checkOccurrenceDue("2026-06-01", "2026-06-01", null, null, 0, true);
    expect(result).toEqual({ isDue: true, reason: null });
  });

  it("is not due before the candidate date arrives", () => {
    const result = checkOccurrenceDue("2026-06-10", "2026-06-01", null, null, 0, true);
    expect(result.isDue).toBe(false);
  });

  it("is not due once the end date has passed", () => {
    const result = checkOccurrenceDue("2026-07-01", "2026-07-01", "2026-06-30", null, 0, true);
    expect(result.isDue).toBe(false);
    expect(result.reason).toMatch(/end date/i);
  });

  it("is not due once the occurrence cap is reached", () => {
    const result = checkOccurrenceDue("2026-06-01", "2026-06-01", null, 5, 5, true);
    expect(result.isDue).toBe(false);
    expect(result.reason).toMatch(/occurrence limit/i);
  });

  it("is not due when the template is inactive", () => {
    const result = checkOccurrenceDue("2026-06-01", "2026-06-01", null, null, 0, false);
    expect(result.isDue).toBe(false);
    expect(result.reason).toMatch(/paused or disabled/i);
  });
});
