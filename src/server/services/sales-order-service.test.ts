import { describe, expect, it } from "vitest";
import { canTransitionOrderStatus, computeOrderDeliveryStatus, validateOrderLines, ValidationError } from "./sales-order-service";
import type { SalesOrderStatus } from "@/server/sales/types";

describe("canTransitionOrderStatus", () => {
  it("allows Draft -> Confirmed -> PartiallyDelivered -> Delivered -> Invoiced", () => {
    expect(canTransitionOrderStatus("Draft", "Confirmed")).toBe(true);
    expect(canTransitionOrderStatus("Confirmed", "PartiallyDelivered")).toBe(true);
    expect(canTransitionOrderStatus("PartiallyDelivered", "Delivered")).toBe(true);
    expect(canTransitionOrderStatus("Delivered", "Invoiced")).toBe(true);
  });

  it("allows Confirmed straight to Delivered when nothing was partial", () => {
    expect(canTransitionOrderStatus("Confirmed", "Delivered")).toBe(true);
  });

  it("treats Invoiced and Cancelled as terminal", () => {
    for (const to of ["Draft", "Confirmed", "PartiallyDelivered", "Delivered", "Invoiced", "Cancelled"] as SalesOrderStatus[]) {
      expect(canTransitionOrderStatus("Invoiced", to)).toBe(false);
      expect(canTransitionOrderStatus("Cancelled", to)).toBe(false);
    }
  });
});

describe("computeOrderDeliveryStatus", () => {
  it("returns Delivered when every line's delivered quantity meets or exceeds ordered", () => {
    const status = computeOrderDeliveryStatus([
      { quantity: 10, deliveredQuantity: 10 },
      { quantity: 5, deliveredQuantity: 5 },
    ]);
    expect(status).toBe("Delivered");
  });

  it("returns PartiallyDelivered when any line is short — the Backorder case", () => {
    const status = computeOrderDeliveryStatus([
      { quantity: 10, deliveredQuantity: 10 },
      { quantity: 5, deliveredQuantity: 2 },
    ]);
    expect(status).toBe("PartiallyDelivered");
  });

  it("returns PartiallyDelivered when nothing has been delivered yet", () => {
    expect(computeOrderDeliveryStatus([{ quantity: 10, deliveredQuantity: 0 }])).toBe("PartiallyDelivered");
  });
});

describe("validateOrderLines", () => {
  it("rejects an empty line list", () => {
    expect(() => validateOrderLines([])).toThrow(ValidationError);
  });

  it("accepts well-formed lines", () => {
    expect(() => validateOrderLines([{ description: "Widget", quantity: 1, unitPrice: 10 }])).not.toThrow();
  });
});
