/**
 * Repository layer for the real FIFO cost-layer ledger. Consumption math
 * itself lives in `server/inventory/costing.ts` (pure); this file only
 * persists the layers and the updates that engine computes.
 */

import { createClient } from "@/lib/supabase/server";
import { stockCostLayerFromRow, type StockCostLayerRow } from "@/server/inventory/mappers";
import type { StockCostLayer } from "@/server/inventory/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function listCostLayers(companyId: string, stockItemId: number, warehouseId?: number): Promise<StockCostLayer[]> {
  const supabase = await createClient();
  let query = supabase.from("stock_cost_layers").select("*").eq("company_id", companyId).eq("stock_item_id", stockItemId).gt("quantity_remaining", 0);
  if (warehouseId !== undefined) query = query.eq("warehouse_id", warehouseId);
  const { data, error } = await query.order("received_date", { ascending: true }).limit(LIST_CAP).returns<StockCostLayerRow[]>();
  if (error) throw error;
  return data.map(stockCostLayerFromRow);
}

export async function createCostLayer(
  companyId: string,
  stockItemId: number,
  warehouseId: number,
  receivedDate: string,
  quantity: number,
  unitCost: number,
): Promise<StockCostLayer> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_cost_layers")
    .insert({ company_id: companyId, stock_item_id: stockItemId, warehouse_id: warehouseId, received_date: receivedDate, quantity_remaining: quantity, unit_cost: unitCost })
    .select("*")
    .single<StockCostLayerRow>();
  if (error) throw error;
  return stockCostLayerFromRow(data);
}

/** Finding #232 — the real "does this warehouse still hold stock"
 * question: real remaining quantity across every item's FIFO cost layers
 * in this warehouse, not `StockItem.quantityOnHand` (which is a
 * company-wide balance, not decomposed per warehouse). Used to block
 * deactivating a warehouse that still has stock sitting in it. */
export async function sumStockOnHandForWarehouse(companyId: string, warehouseId: number): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_cost_layers")
    .select("quantity_remaining")
    .eq("company_id", companyId)
    .eq("warehouse_id", warehouseId)
    .gt("quantity_remaining", 0)
    .returns<{ quantity_remaining: number }[]>();
  if (error) throw error;
  return data.reduce((sum, row) => sum + Number(row.quantity_remaining), 0);
}

export async function applyLayerUpdates(companyId: string, updates: { id: number; quantityRemaining: number }[]): Promise<void> {
  const supabase = await createClient();
  for (const update of updates) {
    const { error } = await supabase.from("stock_cost_layers").update({ quantity_remaining: update.quantityRemaining }).eq("company_id", companyId).eq("id", update.id);
    if (error) throw error;
  }
}
