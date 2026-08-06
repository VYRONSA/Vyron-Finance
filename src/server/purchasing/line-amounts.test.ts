import { describe, expect, it } from "vitest";
import { computeLineAmounts } from "./line-amounts";

describe("computeLineAmounts", () => {
  it("computes net/vat/total from quantity, unit cost, and a VAT rate", () => {
    const result = computeLineAmounts(3, 50, 0, 15);
    expect(result.netAmount).toBe(150);
    expect(result.vatAmount).toBe(22.5);
    expect(result.lineTotal).toBe(172.5);
  });

  it("subtracts a discount before computing VAT", () => {
    const result = computeLineAmounts(10, 20, 25, 15);
    expect(result.netAmount).toBe(175);
    expect(result.vatAmount).toBe(26.25);
  });

  it("collapses lineTotal to netAmount when the VAT rate is zero (no VAT code selected)", () => {
    const result = computeLineAmounts(2, 100, 0, 0);
    expect(result.netAmount).toBe(200);
    expect(result.vatAmount).toBe(0);
    expect(result.lineTotal).toBe(200);
  });

  it("rounds to 2 decimal places", () => {
    const result = computeLineAmounts(3, 33.333, 0, 15);
    expect(result.netAmount).toBe(100);
    expect(result.vatAmount).toBe(15);
  });
});
