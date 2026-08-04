import { describe, expect, it } from "vitest";
import { computeStockLevelStatus } from "./stock-item-service";

describe("computeStockLevelStatus", () => {
  it("flags out of stock when quantity on hand is zero", () => {
    const result = computeStockLevelStatus({ quantityOnHand: 0, reorderLevel: 10, safetyStock: 0 });
    expect(result.isOutOfStock).toBe(true);
    expect(result.needsReorder).toBe(true);
  });

  it("flags out of stock when quantity on hand is negative", () => {
    const result = computeStockLevelStatus({ quantityOnHand: -2, reorderLevel: 10, safetyStock: 0 });
    expect(result.isOutOfStock).toBe(true);
  });

  it("flags low stock when at or below the reorder level but still positive", () => {
    const result = computeStockLevelStatus({ quantityOnHand: 10, reorderLevel: 10, safetyStock: 0 });
    expect(result.isOutOfStock).toBe(false);
    expect(result.isLowStock).toBe(true);
    expect(result.needsReorder).toBe(true);
  });

  it("does not flag low stock above the reorder level", () => {
    const result = computeStockLevelStatus({ quantityOnHand: 11, reorderLevel: 10, safetyStock: 0 });
    expect(result.isLowStock).toBe(false);
    expect(result.needsReorder).toBe(false);
  });

  it("ignores a zero reorder level (not configured) rather than always flagging low stock", () => {
    const result = computeStockLevelStatus({ quantityOnHand: 0, reorderLevel: 0, safetyStock: 0 });
    // still out of stock, but isLowStock specifically should not fire off an unconfigured reorder level
    expect(result.isLowStock).toBe(false);
  });

  it("flags below safety stock independently of the reorder level", () => {
    const result = computeStockLevelStatus({ quantityOnHand: 5, reorderLevel: 0, safetyStock: 8 });
    expect(result.isBelowSafetyStock).toBe(true);
    expect(result.isLowStock).toBe(false);
  });
});
