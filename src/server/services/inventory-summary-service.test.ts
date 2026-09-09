import { describe, expect, it } from "vitest";
import { buildInventoryDashboardSummary } from "./inventory-summary-service";
import type { InventoryTransaction, StockItem } from "@/server/inventory/types";

function item(overrides: Partial<StockItem> & Pick<StockItem, "id">): StockItem {
  return {
    companyId: "co_1", stockCode: `SKU-${overrides.id}`, barcode: "", description: "Item", longDescription: "",
    category: "", subcategory: "", brand: "", unitOfMeasure: "Each", alternativeUnit: "", alternativeUnitFactor: 1,
    defaultWarehouseId: 1, defaultLocationId: null, preferredSupplierId: null, sellingPrice: 100, costPrice: 50,
    quantityOnHand: 10, averageCost: 50, minimumStock: 0, maximumStock: 0, reorderLevel: 5, safetyStock: 0,
    tracksSerialNumbers: false, tracksLotNumbers: false, hasExpiryDate: false, vatTreatmentCode: "", status: "Active",
    notes: "", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function issueTransaction(id: number, date: string, lines: { stockItemId: number; quantity: number }[]): InventoryTransaction {
  return {
    id, companyId: "co_1", transactionType: "Issue", transactionNumber: `ISS${id}`, transactionDate: date, warehouseId: 1,
    destinationWarehouseId: null, status: "Posted", reference: "", notes: "", sourceType: "", sourceId: null, direction: null,
    journalId: 1, createdAt: date, submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: date, postedAt: date,
    cancelledBy: null, cancelledAt: null,
    lines: lines.map((l, i) => ({ id: i, transactionId: id, lineOrder: i, stockItemId: l.stockItemId, quantity: l.quantity, unitCost: 50, serialNumber: "", lotNumber: "", expiryDate: null, notes: "" })),
  };
}

describe("buildInventoryDashboardSummary", () => {
  const TODAY = "2026-07-15";

  it("computes inventory value and stock on hand across active items only", () => {
    const summary = buildInventoryDashboardSummary(
      [item({ id: 1, quantityOnHand: 10, averageCost: 5 }), item({ id: 2, quantityOnHand: 3, averageCost: 20, status: "Inactive" })],
      [],
      TODAY,
    );
    expect(summary.inventoryValue).toBe(50);
    expect(summary.stockOnHandUnits).toBe(10);
    expect(summary.activeItemCount).toBe(1);
  });

  it("counts low stock, out of stock, and reorder alerts", () => {
    const summary = buildInventoryDashboardSummary(
      [
        item({ id: 1, quantityOnHand: 0, reorderLevel: 5 }),
        item({ id: 2, quantityOnHand: 5, reorderLevel: 5 }),
        item({ id: 3, quantityOnHand: 100, reorderLevel: 5 }),
      ],
      [],
      TODAY,
    );
    expect(summary.outOfStockCount).toBe(1);
    expect(summary.lowStockCount).toBe(1);
    expect(summary.reorderAlertCount).toBe(2);
  });

  it("counts dead stock as items with quantity but no recent Posted Issue", () => {
    const summary = buildInventoryDashboardSummary(
      [item({ id: 1, quantityOnHand: 10 }), item({ id: 2, quantityOnHand: 10 })],
      [issueTransaction(1, "2026-07-10", [{ stockItemId: 2, quantity: 1 }])],
      TODAY,
    );
    expect(summary.deadStockCount).toBe(1);
  });

  it("ranks top moving products by quantity issued, not by transaction count", () => {
    const summary = buildInventoryDashboardSummary(
      [item({ id: 1 }), item({ id: 2 })],
      [
        issueTransaction(1, "2026-07-10", [{ stockItemId: 1, quantity: 1 }]),
        issueTransaction(2, "2026-07-11", [{ stockItemId: 2, quantity: 50 }]),
      ],
      TODAY,
    );
    expect(summary.topMovingProducts[0].stockItemId).toBe(2);
    expect(summary.topMovingProducts[0].quantityIssued).toBe(50);
  });

  it("ignores Draft/unposted transactions for dead stock and top moving products", () => {
    const draftIssue: InventoryTransaction = { ...issueTransaction(1, "2026-07-10", [{ stockItemId: 1, quantity: 5 }]), status: "Draft" };
    const summary = buildInventoryDashboardSummary([item({ id: 1, quantityOnHand: 10 })], [draftIssue], TODAY);
    expect(summary.deadStockCount).toBe(1);
    expect(summary.topMovingProducts).toEqual([]);
  });

  it("returns zeros for no items", () => {
    const summary = buildInventoryDashboardSummary([], [], TODAY);
    expect(summary.inventoryValue).toBe(0);
    expect(summary.activeItemCount).toBe(0);
    expect(summary.topMovingProducts).toEqual([]);
  });
});
