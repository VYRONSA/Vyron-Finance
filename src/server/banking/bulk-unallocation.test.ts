import { describe, expect, it } from "vitest";
import { isRequestKey, sumAmounts, validateDateRange } from "./bulk-unallocation";

describe("validateDateRange", () => {
  it("accepts a range whose From Date equals its To Date (a single day)", () => {
    expect(validateDateRange("2026-03-01", "2026-03-01")).toBeNull();
  });

  it("refuses a From Date later than the To Date", () => {
    expect(validateDateRange("2026-03-31", "2026-03-01")).toBe("From Date cannot be later than To Date.");
  });

  it("requires both dates", () => {
    expect(validateDateRange("", "2026-03-01")).toMatch(/Choose a From Date and a To Date/);
    expect(validateDateRange("2026-03-01", "")).toMatch(/Choose a From Date and a To Date/);
  });

  it("refuses dates that are not real calendar dates", () => {
    expect(validateDateRange("2026-02-30", "2026-03-01")).toMatch(/real calendar dates/);
    expect(validateDateRange("01/03/2026", "2026-03-31")).toMatch(/real calendar dates/);
  });
});

describe("sumAmounts", () => {
  it("adds 2-decimal amounts exactly, signs included", () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }, { amount: -100.05 }])).toBe(-99.75);
    expect(sumAmounts([])).toBe(0);
  });
});

describe("isRequestKey", () => {
  it("accepts a UUID and nothing else", () => {
    expect(isRequestKey("5f400000-0000-4000-8000-0000000011ff")).toBe(true);
    expect(isRequestKey("not-a-key")).toBe(false);
    expect(isRequestKey(42)).toBe(false);
  });
});
