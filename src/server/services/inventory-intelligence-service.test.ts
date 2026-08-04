import { describe, expect, it } from "vitest";
import { buildStockItemIntelligence, computeInventoryValue } from "./inventory-intelligence-service";
import type { InventoryTransaction, StockItem } from "@/server/inventory/types";

const ITEM: Pick<StockItem, "stockCode" | "quantityOnHand" | "reorderLevel" | "safetyStock" | "averageCost"> = {
  stockCode: "SKU-1",
  quantityOnHand: 50,
  reorderLevel: 10,
  safetyStock: 5,
  averageCost: 20,
};

function issue(daysAgoFromToday: number, today: string): Pick<InventoryTransaction, "transactionType" | "transactionDate" | "status"> {
  const date = new Date(Date.parse(today) - daysAgoFromToday * 86_400_000).toISOString().slice(0, 10);
  return { transactionType: "Issue", transactionDate: date, status: "Posted" };
}

describe("buildStockItemIntelligence", () => {
  const TODAY = "2026-07-15";

  it("flags out of stock over low stock or movement signals", () => {
    const signals = buildStockItemIntelligence({ ...ITEM, quantityOnHand: 0 }, [], TODAY, null);
    expect(signals.some((s) => s.kind === "out-of-stock")).toBe(true);
    expect(signals.some((s) => s.kind === "low-stock")).toBe(false);
  });

  it("flags low stock at or below the reorder level", () => {
    const signals = buildStockItemIntelligence({ ...ITEM, quantityOnHand: 10 }, [], TODAY, null);
    expect(signals.some((s) => s.kind === "low-stock")).toBe(true);
  });

  it("flags dead stock for an item that has never had an Issue transaction but has quantity on hand", () => {
    const signals = buildStockItemIntelligence(ITEM, [], TODAY, null);
    expect(signals.some((s) => s.kind === "dead-stock")).toBe(true);
  });

  it("flags dead stock when the last issue was over 180 days ago", () => {
    const signals = buildStockItemIntelligence(ITEM, [issue(200, TODAY)], TODAY, null);
    expect(signals.some((s) => s.kind === "dead-stock")).toBe(true);
  });

  it("flags fast moving for frequent recent issues", () => {
    const signals = buildStockItemIntelligence(ITEM, [issue(5, TODAY), issue(10, TODAY), issue(20, TODAY)], TODAY, null);
    expect(signals.some((s) => s.kind === "fast-moving")).toBe(true);
    expect(signals.some((s) => s.kind === "dead-stock")).toBe(false);
  });

  it("flags slow moving for infrequent but not dead activity", () => {
    const signals = buildStockItemIntelligence(ITEM, [issue(60, TODAY)], TODAY, null);
    expect(signals.some((s) => s.kind === "slow-moving")).toBe(true);
  });

  it("does not flag any movement signal for an item with zero quantity on hand", () => {
    const signals = buildStockItemIntelligence({ ...ITEM, quantityOnHand: 0 }, [], TODAY, null);
    expect(signals.some((s) => s.kind === "dead-stock" || s.kind === "fast-moving" || s.kind === "slow-moving")).toBe(false);
  });

  it("reports stock age from the oldest remaining FIFO layer", () => {
    const signals = buildStockItemIntelligence(ITEM, [], TODAY, "2026-01-01");
    const ageSignal = signals.find((s) => s.kind === "stock-age");
    expect(ageSignal?.message).toContain("195 days");
  });

  it("omits stock age when there is no layer to derive it from", () => {
    const signals = buildStockItemIntelligence(ITEM, [], TODAY, null);
    expect(signals.some((s) => s.kind === "stock-age")).toBe(false);
  });
});

describe("computeInventoryValue", () => {
  it("sums quantity on hand times average cost across items", () => {
    expect(computeInventoryValue([{ quantityOnHand: 10, averageCost: 5 }, { quantityOnHand: 3, averageCost: 20 }])).toBe(110);
  });

  it("returns 0 for no items", () => {
    expect(computeInventoryValue([])).toBe(0);
  });
});
