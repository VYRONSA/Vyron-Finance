import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

function fmt(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Master Implementation Tracker — Programme 2, Root Cause RC-13.
describe("formatMoney", () => {
  it("uses the real symbol for known currencies", () => {
    expect(formatMoney(100, "ZAR")).toBe(`R ${fmt(100)}`);
    expect(formatMoney(100, "USD")).toBe(`$ ${fmt(100)}`);
    expect(formatMoney(100, "GBP")).toBe(`£ ${fmt(100)}`);
  });

  it("falls back to the currency code itself for an unknown currency — never a wrong symbol, never a silent ZAR default", () => {
    expect(formatMoney(100, "XYZ")).toBe(`XYZ ${fmt(100)}`);
  });
});
