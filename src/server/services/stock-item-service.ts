/**
 * Service layer for the Stock Master. No accounting impact itself — an
 * item's `quantityOnHand`/`averageCost` only ever change through
 * `inventory-transaction-service.ts`, never here.
 */

import * as repo from "@/server/repositories/stock-item-repository";
import type { StockItem } from "@/server/inventory/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export function validateStockItemInput(input: { stockCode: string; description: string }): void {
  if (!input.stockCode?.trim()) throw new ValidationError("Stock code is required.");
  if (!input.description?.trim()) throw new ValidationError("Description is required.");
}

export const listStockItems = repo.listStockItems;
export const getStockItem = repo.getStockItem;

export async function createStockItem(companyId: string, input: repo.NewStockItem): Promise<StockItem> {
  validateStockItemInput(input);
  return repo.createStockItem(companyId, input);
}

export async function updateStockItem(companyId: string, stockItemId: number, fields: Partial<repo.NewStockItem>): Promise<StockItem> {
  const item = await repo.getStockItem(companyId, stockItemId);
  if (!item) throw new NotFoundError(`No stock item with id ${stockItemId}.`);
  return repo.updateStockItem(companyId, stockItemId, fields);
}

export const setStockItemStatus = repo.setStockItemStatus;

/** Pure — unit tested. Real, computable reorder signals: "Low Stock"
 * means on-hand has dropped to or below the reorder level but isn't
 * zero yet; "Out of Stock" is exactly what it says; below `safetyStock`
 * (if set) is flagged separately since it's a stricter buffer than the
 * reorder level. */
export function computeStockLevelStatus(item: Pick<StockItem, "quantityOnHand" | "reorderLevel" | "safetyStock">): {
  isOutOfStock: boolean;
  isLowStock: boolean;
  isBelowSafetyStock: boolean;
  needsReorder: boolean;
} {
  const isOutOfStock = item.quantityOnHand <= 0;
  const isLowStock = !isOutOfStock && item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel;
  const isBelowSafetyStock = item.safetyStock > 0 && item.quantityOnHand < item.safetyStock;
  return { isOutOfStock, isLowStock, isBelowSafetyStock, needsReorder: isOutOfStock || isLowStock };
}
