/**
 * Service layer for Stock Takes. No accounting impact itself — finalizing
 * one creates a real Inventory Adjustment transaction (via
 * `inventory-transaction-service.ts::createAndAutoPost`) for every line
 * whose counted quantity differs from the system quantity, so a stock
 * take's variances flow through the exact same Posting Rule any other
 * adjustment does — no separate "stock take journal" concept.
 */

import * as repo from "@/server/repositories/stock-take-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import * as txnService from "@/server/services/inventory-transaction-service";
import type { StockTake } from "@/server/inventory/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listStockTakes = repo.listStockTakes;
export const getStockTake = repo.getStockTake;

export type NewStockTakeInput = {
  warehouseId: number;
  countDate: string;
  notes?: string;
  lines: { stockItemId: number; countedQuantity: number }[];
};

/** Captures each line's `systemQuantity` from the item's current
 * `quantityOnHand` at creation time — a real snapshot, not recomputed
 * later, so the variance a user sees is the variance that actually
 * existed when they counted. */
export async function createStockTake(companyId: string, input: NewStockTakeInput): Promise<StockTake> {
  if (!input.warehouseId) throw new ValidationError("Warehouse is required.");
  if (!input.countDate) throw new ValidationError("Count date is required.");
  if (input.lines.length === 0) throw new ValidationError("A stock take needs at least one line.");

  const lines = await Promise.all(
    input.lines.map(async (line) => {
      const item = await itemRepo.getStockItem(companyId, line.stockItemId);
      if (!item) throw new NotFoundError(`No stock item with id ${line.stockItemId}.`);
      return { stockItemId: line.stockItemId, systemQuantity: item.quantityOnHand, countedQuantity: line.countedQuantity };
    }),
  );

  return repo.createStockTake(companyId, { warehouseId: input.warehouseId, countDate: input.countDate, notes: input.notes, lines });
}

/** Real, automatic variance posting — every line with a non-zero
 * variance becomes its own Inventory Adjustment transaction (increase or
 * decrease, whichever the variance's sign calls for), created and posted
 * in the same call via `createAndAutoPost`. Lines with no variance are
 * skipped entirely — nothing to adjust, nothing to post. */
export async function finalizeStockTake(companyId: string, stockTakeId: number, performedBy?: string): Promise<{ stockTake: StockTake; adjustmentsCreated: number }> {
  const stockTake = await repo.getStockTake(companyId, stockTakeId);
  if (!stockTake) throw new NotFoundError(`No stock take with id ${stockTakeId}.`);
  if (stockTake.status !== "Draft") {
    throw new ValidationError(`Only a Draft stock take can be finalized (current status: ${stockTake.status}).`);
  }

  let adjustmentsCreated = 0;
  for (const line of stockTake.lines) {
    const variance = Math.round((line.countedQuantity - line.systemQuantity) * 10000) / 10000;
    if (variance === 0) continue;

    const direction = variance > 0 ? "Increase" : "Decrease";
    const item = await itemRepo.getStockItem(companyId, line.stockItemId);
    if (!item) throw new NotFoundError(`No stock item with id ${line.stockItemId}.`);

    await txnService.createAndAutoPost(companyId, "Adjustment", {
      transactionDate: stockTake.countDate,
      warehouseId: stockTake.warehouseId,
      reference: stockTake.stockTakeNumber,
      notes: `Stock take variance for ${item.stockCode}`,
      sourceType: "stock_take",
      sourceId: stockTake.id,
      direction,
      lines: [{ stockItemId: line.stockItemId, quantity: Math.abs(variance), unitCost: item.averageCost }],
    });
    adjustmentsCreated += 1;
  }

  const finalized = await repo.setStockTakeStatus(companyId, stockTakeId, "Finalized", performedBy);
  return { stockTake: finalized, adjustmentsCreated };
}
