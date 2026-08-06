import { describe, expect, it } from "vitest";
import { computeBillLine, lineAmountFor, ValidationError } from "./purchase-bill-service";
import type { PurchaseBillLine } from "@/server/accounting/types";

function line(id: number): PurchaseBillLine {
  return {
    id,
    companyId: "co_1",
    billId: 1,
    lineOrder: 0,
    description: "Test line",
    glAccount: "5000",
    vatCode: "STD",
    costCentreId: null,
    projectId: null,
    departmentId: null,
    quantity: 1,
    unitCost: 100,
    discount: 0,
    netAmount: 100,
    vatAmount: 15,
    lineTotal: 115,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("computeBillLine", () => {
  it("computes net/vat/total from quantity, unit cost, and a VAT rate", () => {
    const result = computeBillLine({ description: "Stationery", glAccount: "5100", vatCode: "STD", quantity: 3, unitCost: 50 }, 15);
    expect(result.netAmount).toBe(150);
    expect(result.vatAmount).toBe(22.5);
    expect(result.lineTotal).toBe(172.5);
  });

  it("subtracts a discount before computing VAT", () => {
    const result = computeBillLine({ description: "Bulk order", glAccount: "5100", vatCode: "STD", quantity: 10, unitCost: 20, discount: 25 }, 15);
    expect(result.netAmount).toBe(175);
    expect(result.vatAmount).toBe(26.25);
  });

  it("defaults discount to zero when omitted", () => {
    const result = computeBillLine({ description: "No discount", glAccount: "5100", vatCode: "STD", quantity: 1, unitCost: 10 }, 0);
    expect(result.discount).toBe(0);
    expect(result.netAmount).toBe(10);
  });

  it("rejects a line with no GL account", () => {
    expect(() => computeBillLine({ description: "x", glAccount: "", vatCode: "STD", quantity: 1, unitCost: 10 }, 15)).toThrow(ValidationError);
  });

  it("rejects a line with zero or negative quantity", () => {
    expect(() => computeBillLine({ description: "x", glAccount: "5100", vatCode: "STD", quantity: 0, unitCost: 10 }, 15)).toThrow(ValidationError);
  });

  it("rejects a line whose discount consumes the entire net amount", () => {
    expect(() => computeBillLine({ description: "x", glAccount: "5100", vatCode: "STD", quantity: 1, unitCost: 10, discount: 10 }, 15)).toThrow(ValidationError);
  });
});

describe("lineAmountFor", () => {
  it("returns the line's net amount for a 'net' amount source", () => {
    expect(lineAmountFor(line(1), "net")).toBe(100);
  });

  it("returns the line's VAT amount for a 'vat' amount source", () => {
    expect(lineAmountFor(line(1), "vat")).toBe(15);
  });

  it("returns the line's total for a 'gross' amount source", () => {
    expect(lineAmountFor(line(1), "gross")).toBe(115);
  });
});
