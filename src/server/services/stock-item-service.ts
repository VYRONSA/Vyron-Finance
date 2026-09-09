/**
 * Service layer for the Stock Master. No accounting impact itself — an
 * item's `quantityOnHand`/`averageCost` only ever change through
 * `inventory-transaction-service.ts`, never here.
 */

import * as repo from "@/server/repositories/stock-item-repository";
import { recordPermissionAuditEntry } from "@/server/repositories/permission-repository";
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

/** Pilot Review Round 1, Phase 10 — cost price is the one Stock Master
 * field with direct margin/valuation exposure (it feeds selling-price
 * margin calculations and is the default cost new stock movements
 * inherit), gated behind `Inventory:Approve` — same reused-grant pattern
 * as Customer creditLimit (`Sales:Approve`) / Supplier banking details
 * (`Purchasing:Approve`), not a new permission key. */
export function editRequiresElevatedPermission(fields: Partial<repo.NewStockItem>): boolean {
  return fields.costPrice !== undefined;
}

export async function updateStockItem(companyId: string, stockItemId: number, fields: Partial<repo.NewStockItem>, performedBy = "System", reason = ""): Promise<StockItem> {
  const existing = await repo.getStockItem(companyId, stockItemId);
  if (!existing) throw new NotFoundError(`No stock item with id ${stockItemId}.`);

  const updated = await repo.updateStockItem(companyId, stockItemId, fields);

  // Every editable field, not a hand-picked subset — same discipline
  // `customer-service.ts`/`supplier-management-service.ts` established.
  const fieldChanges: [string, unknown, unknown][] = [
    ["barcode", existing.barcode, updated.barcode],
    ["description", existing.description, updated.description],
    ["longDescription", existing.longDescription, updated.longDescription],
    ["category", existing.category, updated.category],
    ["subcategory", existing.subcategory, updated.subcategory],
    ["brand", existing.brand, updated.brand],
    ["unitOfMeasure", existing.unitOfMeasure, updated.unitOfMeasure],
    ["alternativeUnit", existing.alternativeUnit, updated.alternativeUnit],
    ["alternativeUnitFactor", existing.alternativeUnitFactor, updated.alternativeUnitFactor],
    ["defaultWarehouseId", existing.defaultWarehouseId, updated.defaultWarehouseId],
    ["defaultLocationId", existing.defaultLocationId, updated.defaultLocationId],
    ["preferredSupplierId", existing.preferredSupplierId, updated.preferredSupplierId],
    ["sellingPrice", existing.sellingPrice, updated.sellingPrice],
    ["costPrice", existing.costPrice, updated.costPrice],
    ["minimumStock", existing.minimumStock, updated.minimumStock],
    ["maximumStock", existing.maximumStock, updated.maximumStock],
    ["reorderLevel", existing.reorderLevel, updated.reorderLevel],
    ["safetyStock", existing.safetyStock, updated.safetyStock],
    ["vatTreatmentCode", existing.vatTreatmentCode, updated.vatTreatmentCode],
    ["notes", existing.notes, updated.notes],
  ];
  for (const [field, oldValue, newValue] of fieldChanges) {
    if (oldValue !== newValue) {
      await recordPermissionAuditEntry(companyId, "StockItem", String(stockItemId), field, String(oldValue), String(newValue), reason || "Stock item details updated.", performedBy);
    }
  }

  return updated;
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
