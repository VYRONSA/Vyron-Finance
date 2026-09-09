/**
 * Inventory Intelligence — real, computed signals, explicitly not AI/ML
 * (same honest framing as every other Intelligence engine in this
 * codebase). Pure — unit tested. Every signal is a plain computed fact
 * with a `confidence` reflecting how directly it's derived.
 */

import { computeStockLevelStatus } from "@/server/services/stock-item-service";
import type { InventoryTransaction, StockItem } from "@/server/inventory/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const DEAD_STOCK_DAYS = 180;
const FAST_MOVING_DAYS = 30;
const RECENT_WINDOW_DAYS = 90;

export type StockItemIntelligenceSignal = {
  kind: "out-of-stock" | "low-stock" | "dead-stock" | "fast-moving" | "slow-moving" | "stock-age";
  message: string;
  reasoning: string;
  confidence: number;
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Pure — unit tested. `transactions` should be every Posted transaction
 * for this item (any type); only Issues are used to judge movement
 * speed. `oldestLayerReceivedDate` (from `stock_cost_layers`) drives the
 * Stock Age signal — `null` when there's no stock on hand to age. */
export function buildStockItemIntelligence(
  item: Pick<StockItem, "stockCode" | "quantityOnHand" | "reorderLevel" | "safetyStock" | "averageCost">,
  transactions: Pick<InventoryTransaction, "transactionType" | "transactionDate" | "status">[],
  todayIso: string,
  oldestLayerReceivedDate: string | null,
): StockItemIntelligenceSignal[] {
  const signals: StockItemIntelligenceSignal[] = [];
  const levelStatus = computeStockLevelStatus(item);

  if (levelStatus.isOutOfStock) {
    signals.push({
      kind: "out-of-stock",
      message: `${item.stockCode} is out of stock.`,
      reasoning: "Quantity on hand is zero or less.",
      confidence: 100,
    });
  } else if (levelStatus.isLowStock) {
    signals.push({
      kind: "low-stock",
      message: `${item.stockCode} is low on stock (${item.quantityOnHand} on hand, reorder level ${item.reorderLevel}).`,
      reasoning: "Quantity on hand has dropped to or below the reorder level.",
      confidence: 100,
    });
  }

  const postedIssues = transactions.filter((t) => t.transactionType === "Issue" && t.status === "Posted");
  const lastIssueDate = postedIssues.length > 0 ? postedIssues.map((t) => t.transactionDate).sort().at(-1)! : null;
  const recentIssueCount = postedIssues.filter((t) => daysBetween(t.transactionDate, todayIso) <= RECENT_WINDOW_DAYS).length;

  if (item.quantityOnHand > 0) {
    const daysSinceLastIssue = lastIssueDate ? daysBetween(lastIssueDate, todayIso) : null;
    if (daysSinceLastIssue === null || daysSinceLastIssue > DEAD_STOCK_DAYS) {
      signals.push({
        kind: "dead-stock",
        message: `${item.stockCode} has ${daysSinceLastIssue === null ? "never sold" : `not sold in ${daysSinceLastIssue} days`} while carrying ${item.quantityOnHand} units on hand.`,
        reasoning: `No Issue transaction in over ${DEAD_STOCK_DAYS} days — real capital tied up in stock that isn't moving.`,
        confidence: 80,
      });
    } else if (daysSinceLastIssue <= FAST_MOVING_DAYS && recentIssueCount >= 2) {
      signals.push({
        kind: "fast-moving",
        message: `${item.stockCode} is fast moving — ${recentIssueCount} sales in the last ${RECENT_WINDOW_DAYS} days.`,
        reasoning: `${recentIssueCount} Issue transactions within ${RECENT_WINDOW_DAYS} days, most recently ${daysSinceLastIssue} day(s) ago.`,
        confidence: 70,
      });
    } else if (recentIssueCount <= 1) {
      signals.push({
        kind: "slow-moving",
        message: `${item.stockCode} is slow moving — ${recentIssueCount} sale(s) in the last ${RECENT_WINDOW_DAYS} days.`,
        reasoning: `Fewer than 2 Issue transactions within the last ${RECENT_WINDOW_DAYS} days.`,
        confidence: 60,
      });
    }
  }

  if (oldestLayerReceivedDate && item.quantityOnHand > 0) {
    const ageDays = daysBetween(oldestLayerReceivedDate, todayIso);
    signals.push({
      kind: "stock-age",
      message: `Oldest stock on hand is ${ageDays} days old.`,
      reasoning: `The oldest unconsumed FIFO layer for ${item.stockCode} was received ${oldestLayerReceivedDate}.`,
      confidence: 100,
    });
  }

  return signals;
}

export function computeInventoryValue(items: Pick<StockItem, "quantityOnHand" | "averageCost">[]): number {
  return round2(items.reduce((sum, item) => sum + item.quantityOnHand * item.averageCost, 0));
}
