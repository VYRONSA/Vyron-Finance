/**
 * Shared Inventory summary math — the single place "Inventory Value",
 * "Stock on Hand", "Low Stock", "Out of Stock", "Reorder Alerts", "Dead
 * Stock", and "Top Moving Products" are computed, so the Inventory
 * workspace and the Dashboard can never quietly restate the same
 * numbers differently. Mirrors `sales-summary-service.ts`/
 * `purchasing-summary-service.ts`. Pure — unit tested.
 */

import { computeStockLevelStatus } from "@/server/services/stock-item-service";
import { computeInventoryValue } from "@/server/services/inventory-intelligence-service";
import type { InventoryTransaction, StockItem } from "@/server/inventory/types";

const DEAD_STOCK_DAYS = 180;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export type InventoryDashboardSummary = {
  inventoryValue: number;
  stockOnHandUnits: number;
  activeItemCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  reorderAlertCount: number;
  deadStockCount: number;
  topMovingProducts: { stockItemId: number; stockCode: string; description: string; quantityIssued: number }[];
};

export function buildInventoryDashboardSummary(
  items: StockItem[],
  transactions: InventoryTransaction[],
  todayIso: string,
  topN = 5,
): InventoryDashboardSummary {
  const activeItems = items.filter((i) => i.status === "Active");

  let lowStockCount = 0;
  let outOfStockCount = 0;
  let reorderAlertCount = 0;

  const postedIssuesByItem = new Map<number, { transactionDate: string }[]>();
  for (const transaction of transactions) {
    if (transaction.transactionType !== "Issue" || transaction.status !== "Posted") continue;
    for (const line of transaction.lines) {
      const list = postedIssuesByItem.get(line.stockItemId) ?? [];
      list.push({ transactionDate: transaction.transactionDate });
      postedIssuesByItem.set(line.stockItemId, list);
    }
  }

  let deadStockCount = 0;
  for (const item of activeItems) {
    const levelStatus = computeStockLevelStatus(item);
    if (levelStatus.isOutOfStock) outOfStockCount += 1;
    if (levelStatus.isLowStock) lowStockCount += 1;
    if (levelStatus.needsReorder) reorderAlertCount += 1;

    if (item.quantityOnHand > 0) {
      const issues = postedIssuesByItem.get(item.id) ?? [];
      const lastIssueDate = issues.length > 0 ? issues.map((i) => i.transactionDate).sort().at(-1)! : null;
      const daysSinceLastIssue = lastIssueDate ? daysBetween(lastIssueDate, todayIso) : null;
      if (daysSinceLastIssue === null || daysSinceLastIssue > DEAD_STOCK_DAYS) deadStockCount += 1;
    }
  }

  const quantityIssuedByItem = new Map<number, number>();
  for (const transaction of transactions) {
    if (transaction.transactionType !== "Issue" || transaction.status !== "Posted") continue;
    for (const line of transaction.lines) {
      quantityIssuedByItem.set(line.stockItemId, (quantityIssuedByItem.get(line.stockItemId) ?? 0) + line.quantity);
    }
  }

  const topMovingProducts = [...quantityIssuedByItem.entries()]
    .map(([stockItemId, quantityIssued]) => {
      const item = items.find((i) => i.id === stockItemId);
      return { stockItemId, stockCode: item?.stockCode ?? `#${stockItemId}`, description: item?.description ?? "", quantityIssued };
    })
    .sort((a, b) => b.quantityIssued - a.quantityIssued)
    .slice(0, topN);

  return {
    inventoryValue: computeInventoryValue(activeItems),
    stockOnHandUnits: Math.round(activeItems.reduce((sum, i) => sum + i.quantityOnHand, 0) * 100) / 100,
    activeItemCount: activeItems.length,
    lowStockCount,
    outOfStockCount,
    reorderAlertCount,
    deadStockCount,
    topMovingProducts,
  };
}
