import { describe, expect, it } from "vitest";
import { canTransitionOrderStatus, computeOrderLine, computeOrderReceiptStatus, validateOrderLines, ValidationError } from "./purchase-order-service";

describe("validateOrderLines", () => {
  it("rejects zero lines", () => {
    expect(() => validateOrderLines([])).toThrow(ValidationError);
  });

  it("accepts a well-formed line", () => {
    expect(() => validateOrderLines([{ description: "Widget", quantity: 1, unitPrice: 10 }])).not.toThrow();
  });
});

describe("computeOrderLine", () => {
  it("computes net/vat amounts and defaults discount to zero", () => {
    const result = computeOrderLine({ quantity: 2, unitPrice: 100 }, 15);
    expect(result.discount).toBe(0);
    expect(result.netAmount).toBe(200);
    expect(result.vatAmount).toBe(30);
  });

  it("leaves netAmount/vatAmount at their arithmetic result with no VAT rate (GL/VAT are optional on a PO line)", () => {
    const result = computeOrderLine({ quantity: 1, unitPrice: 500, discount: 50 }, 0);
    expect(result.netAmount).toBe(450);
    expect(result.vatAmount).toBe(0);
  });

  it("preserves every other field on the input", () => {
    const result = computeOrderLine({ description: "Bulk order", quantity: 3, unitPrice: 20, glAccount: "5100" }, 15);
    expect(result.description).toBe("Bulk order");
    expect(result.glAccount).toBe("5100");
  });
});

describe("canTransitionOrderStatus", () => {
  it("allows Draft -> Submitted", () => {
    expect(canTransitionOrderStatus("Draft", "Submitted")).toBe(true);
  });

  it("disallows Draft -> Received", () => {
    expect(canTransitionOrderStatus("Draft", "Received")).toBe(false);
  });
});

describe("computeOrderReceiptStatus", () => {
  it("returns Received when every line is fully received", () => {
    expect(computeOrderReceiptStatus([{ quantity: 5, receivedQuantity: 5 }])).toBe("Received");
  });

  it("returns PartiallyReceived when any line is short", () => {
    expect(computeOrderReceiptStatus([{ quantity: 5, receivedQuantity: 3 }])).toBe("PartiallyReceived");
  });
});
