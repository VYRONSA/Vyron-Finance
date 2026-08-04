/**
 * Pure inventory costing engine — real FIFO layer consumption and
 * weighted-average cost, shared by every service that moves stock
 * (Inventory Issue, Transfers, Adjustments, Sales/Purchasing
 * integration). No Supabase access here; the repository layer persists
 * whatever these functions compute. Unit tested exhaustively — this is
 * the one place a costing bug would silently corrupt every future
 * journal, so it stays isolated and pure.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type CostLayer = {
  id: number;
  quantityRemaining: number;
  unitCost: number;
  receivedDate: string;
};

export type FifoConsumptionResult = {
  /** Total cost of the quantity actually consumed (oldest layers first). */
  consumedCost: number;
  /** Per-layer remaining-quantity updates to persist. */
  layerUpdates: { id: number; quantityRemaining: number }[];
  /** Quantity requested but not available in any layer — 0 when fully covered. */
  shortfall: number;
};

/** Consumes the oldest layers (by `receivedDate`) first until
 * `quantityToConsume` is satisfied or layers run out. Never mutates the
 * input array. A `shortfall > 0` means the caller asked to issue more
 * than is on hand — the caller decides whether that's a hard error or an
 * allowed negative-stock movement; this function only reports the fact. */
export function consumeFifoLayers(layers: CostLayer[], quantityToConsume: number): FifoConsumptionResult {
  const ordered = [...layers].sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : a.receivedDate > b.receivedDate ? 1 : a.id - b.id));

  let remainingToConsume = round2(quantityToConsume);
  let consumedCost = 0;
  const layerUpdates: { id: number; quantityRemaining: number }[] = [];

  for (const layer of ordered) {
    if (remainingToConsume <= 0) break;
    const consumedFromLayer = Math.min(layer.quantityRemaining, remainingToConsume);
    if (consumedFromLayer <= 0) continue;
    consumedCost = round2(consumedCost + consumedFromLayer * layer.unitCost);
    layerUpdates.push({ id: layer.id, quantityRemaining: round2(layer.quantityRemaining - consumedFromLayer) });
    remainingToConsume = round2(remainingToConsume - consumedFromLayer);
  }

  return { consumedCost, layerUpdates, shortfall: Math.max(remainingToConsume, 0) };
}

/** Standard moving-average formula, guarding the zero-quantity case (a
 * brand new item's first receipt just becomes the average). */
export function computeWeightedAverageCost(
  currentQuantity: number,
  currentAverageCost: number,
  incomingQuantity: number,
  incomingUnitCost: number,
): number {
  const totalQuantity = currentQuantity + incomingQuantity;
  if (totalQuantity <= 0) return 0;
  const totalValue = currentQuantity * currentAverageCost + incomingQuantity * incomingUnitCost;
  return round2(totalValue / totalQuantity);
}

/** The cost of the next unit to be issued — the oldest remaining layer's
 * unit cost, or `null` when there's no stock to derive it from (an
 * honest "not enough data", not a fabricated 0). */
export function currentFifoCost(layers: Pick<CostLayer, "quantityRemaining" | "unitCost" | "receivedDate">[]): number | null {
  const withStock = layers.filter((l) => l.quantityRemaining > 0);
  if (withStock.length === 0) return null;
  const oldest = [...withStock].sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1))[0];
  return oldest.unitCost;
}
