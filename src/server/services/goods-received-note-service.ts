/**
 * Service layer for Goods Received Notes. After creating a GRN against a
 * Purchase Order, refreshes that order's status (Approved ->
 * PartiallyReceived/Received) from its lines' real received-vs-ordered
 * quantities — mirrors `delivery-service.ts`.
 *
 * "Purchasing should automatically update inventory": any GRN line
 * carrying a real `stockItemId` triggers a real Inventory Receipt
 * (`inventory-transaction-service.ts::createAndAutoPost`) in the same
 * call — a genuine DR Inventory / CR GRNI Clearing journal, not a
 * simulated one. A line with no stock item (a service/non-stock line)
 * triggers nothing, exactly as before this module existed.
 */

import * as repo from "@/server/repositories/goods-received-note-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import { incrementOrderLineQuantity } from "@/server/repositories/purchase-order-repository";
import { refreshOrderReceiptStatus } from "@/server/services/purchase-order-service";
import { createAndAutoPost, reverseGoodsReceipt } from "@/server/services/inventory-transaction-service";
import type { GoodsReceivedNote } from "@/server/purchasing/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export function validateGrnLines(lines: { description: string; quantity: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A goods received note needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
  }
}

export const listGoodsReceivedNotes = repo.listGoodsReceivedNotes;
export const getGoodsReceivedNote = repo.getGoodsReceivedNote;

/** Creating a GRN IS the receipt event — recorded as `Received`
 * immediately (no separate Draft/confirm step for the GRN document
 * itself; the real Inventory Receipt transaction it triggers for stock
 * lines DOES go through the full Draft->Approved->Posted workflow,
 * just automatically in this same call). */
export async function createGoodsReceivedNote(companyId: string, input: repo.NewGoodsReceivedNote): Promise<GoodsReceivedNote> {
  if (!input.supplierId) throw new ValidationError("Supplier is required.");
  if (!input.receivedDate) throw new ValidationError("Received date is required.");
  validateGrnLines(input.lines);

  const created = await repo.createGoodsReceivedNote(companyId, input);
  const grn = await repo.setGrnStatus(companyId, created.id, "Received");
  if (input.orderId) await refreshOrderReceiptStatus(companyId, input.orderId);

  const stockLines = grn.lines.filter((line) => line.stockItemId !== null);
  if (stockLines.length > 0) {
    for (const line of stockLines) {
      const item = await itemRepo.getStockItem(companyId, line.stockItemId!);
      if (!item) throw new ValidationError(`No stock item with id ${line.stockItemId}.`);
      if (!item.defaultWarehouseId) {
        throw new ValidationError(`${item.stockCode} has no default warehouse set — required to receive stock automatically.`);
      }
      await createAndAutoPost(companyId, "Receipt", {
        transactionDate: grn.receivedDate,
        warehouseId: item.defaultWarehouseId,
        reference: grn.grnNumber,
        notes: `Goods received: ${item.stockCode}`,
        sourceType: "goods_received_note",
        sourceId: grn.id,
        lines: [{ stockItemId: item.id, quantity: line.quantity, unitCost: line.unitCost }],
      });
    }
  }

  return grn;
}

/** Workflow Completion Audit fix: cancelling a GRN used to only flip its
 * own status — it never reversed the `received_quantity` it had added to
 * the Purchase Order line, nor the real DR Inventory / CR GRNI Clearing
 * journal that was posted automatically for any stock line at receipt
 * time. That silently overstated inventory and left an un-reversed
 * liability on the books — a real accounting-integrity defect, not
 * merely a missing feature. Now genuinely reverses both, per line, in
 * the same order they were originally applied. */
export async function cancelGoodsReceivedNote(companyId: string, grnId: number): Promise<GoodsReceivedNote> {
  const grn = await repo.getGoodsReceivedNote(companyId, grnId);
  if (!grn) throw new NotFoundError(`No goods received note with id ${grnId}.`);
  if (grn.status === "Cancelled") throw new ValidationError(`${grn.grnNumber} is already cancelled.`);

  const stockLines = grn.lines.filter((line) => line.stockItemId !== null);
  for (const line of stockLines) {
    const item = await itemRepo.getStockItem(companyId, line.stockItemId!);
    if (!item) throw new ValidationError(`No stock item with id ${line.stockItemId}.`);
    if (!item.defaultWarehouseId) throw new ValidationError(`${item.stockCode} has no default warehouse set.`);
    await reverseGoodsReceipt(companyId, item.defaultWarehouseId, [{ stockItemId: item.id, quantity: line.quantity }], grn.grnNumber, "goods_received_note_reversal", grn.id);
  }

  for (const line of grn.lines) {
    if (line.orderLineId) await incrementOrderLineQuantity(line.orderLineId, "received_quantity", -line.quantity);
  }

  const cancelled = await repo.setGrnStatus(companyId, grnId, "Cancelled");
  if (grn.orderId) await refreshOrderReceiptStatus(companyId, grn.orderId);
  return cancelled;
}
