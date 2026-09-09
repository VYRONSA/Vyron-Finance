/**
 * Repository layer for Stock Takes. No accounting impact itself —
 * finalizing one creates real Inventory Adjustment transactions per
 * variance line (see `stock-take-service.ts`).
 */

import { createClient } from "@/lib/supabase/server";
import { stockTakeFromRow, type StockTakeRow } from "@/server/inventory/mappers";
import type { StockTake, StockTakeStatus } from "@/server/inventory/types";

const STOCK_TAKE_SELECT = "*, stock_take_lines(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function nextStockTakeNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("stock_takes").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `ST${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listStockTakes(companyId: string): Promise<StockTake[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_takes")
    .select(STOCK_TAKE_SELECT)
    .eq("company_id", companyId)
    .order("count_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<StockTakeRow[]>();
  if (error) throw error;
  return data.map(stockTakeFromRow);
}

export async function getStockTake(companyId: string, stockTakeId: number): Promise<StockTake | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_takes")
    .select(STOCK_TAKE_SELECT)
    .eq("company_id", companyId)
    .eq("id", stockTakeId)
    .maybeSingle<StockTakeRow>();
  if (error) throw error;
  return data ? stockTakeFromRow(data) : null;
}

export type NewStockTakeLine = { stockItemId: number; systemQuantity: number; countedQuantity: number };
export type NewStockTake = {
  stockTakeNumber?: string;
  warehouseId: number;
  countDate: string;
  notes?: string;
  lines: NewStockTakeLine[];
};

export async function createStockTake(companyId: string, input: NewStockTake): Promise<StockTake> {
  const supabase = await createClient();
  const stockTakeNumber = input.stockTakeNumber ?? (await nextStockTakeNumber(companyId));

  const { data: headerRow, error: headerError } = await supabase
    .from("stock_takes")
    .insert({ company_id: companyId, stock_take_number: stockTakeNumber, warehouse_id: input.warehouseId, count_date: input.countDate, notes: input.notes ?? "" })
    .select("*")
    .single<StockTakeRow>();
  if (headerError) throw headerError;

  const { data: lineRows, error: linesError } = await supabase
    .from("stock_take_lines")
    .insert(
      input.lines.map((line) => ({
        stock_take_id: headerRow.id,
        stock_item_id: line.stockItemId,
        system_quantity: line.systemQuantity,
        counted_quantity: line.countedQuantity,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  return stockTakeFromRow({ ...headerRow, stock_take_lines: lineRows });
}

export async function setStockTakeStatus(companyId: string, stockTakeId: number, status: StockTakeStatus, finalizedBy?: string): Promise<StockTake> {
  const supabase = await createClient();
  const fields: Record<string, unknown> = { status };
  if (status === "Finalized") {
    fields.finalized_by = finalizedBy ?? null;
    fields.finalized_at = new Date().toISOString();
  }
  const { error } = await supabase.from("stock_takes").update(fields).eq("company_id", companyId).eq("id", stockTakeId);
  if (error) throw error;
  const stockTake = await getStockTake(companyId, stockTakeId);
  if (!stockTake) throw new Error(`No stock take with id ${stockTakeId}`);
  return stockTake;
}
