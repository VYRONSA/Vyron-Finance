/**
 * Repository layer for the Stock Master. `quantity_on_hand`/
 * `average_cost` are maintained running totals — every function that
 * changes them takes the new value explicitly (computed by the pure
 * costing engine in `server/inventory/costing.ts`), never derives it
 * itself, so the repository stays a thin persistence layer.
 */

import { createClient } from "@/lib/supabase/server";
import { stockItemFromRow, type StockItemRow } from "@/server/inventory/mappers";
import type { StockItem, StockItemStatus } from "@/server/inventory/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listStockItems(companyId: string): Promise<StockItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("stock_items").select("*").eq("company_id", companyId).order("stock_code").limit(LIST_CAP).returns<StockItemRow[]>();
  if (error) throw error;
  return data.map(stockItemFromRow);
}

export async function getStockItem(companyId: string, stockItemId: number): Promise<StockItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", stockItemId)
    .maybeSingle<StockItemRow>();
  if (error) throw error;
  return data ? stockItemFromRow(data) : null;
}

export type NewStockItem = {
  stockCode: string;
  barcode?: string;
  description: string;
  longDescription?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  unitOfMeasure?: string;
  alternativeUnit?: string;
  alternativeUnitFactor?: number;
  defaultWarehouseId?: number | null;
  defaultLocationId?: number | null;
  preferredSupplierId?: number | null;
  sellingPrice?: number;
  costPrice?: number;
  minimumStock?: number;
  maximumStock?: number;
  reorderLevel?: number;
  safetyStock?: number;
  tracksSerialNumbers?: boolean;
  tracksLotNumbers?: boolean;
  hasExpiryDate?: boolean;
  vatTreatmentCode?: string;
  notes?: string;
};

export async function createStockItem(companyId: string, input: NewStockItem): Promise<StockItem> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .insert({
      company_id: companyId,
      stock_code: input.stockCode,
      barcode: input.barcode ?? "",
      description: input.description,
      long_description: input.longDescription ?? "",
      category: input.category ?? "",
      subcategory: input.subcategory ?? "",
      brand: input.brand ?? "",
      unit_of_measure: input.unitOfMeasure ?? "Each",
      alternative_unit: input.alternativeUnit ?? "",
      alternative_unit_factor: input.alternativeUnitFactor ?? 1,
      default_warehouse_id: input.defaultWarehouseId ?? null,
      default_location_id: input.defaultLocationId ?? null,
      preferred_supplier_id: input.preferredSupplierId ?? null,
      selling_price: input.sellingPrice ?? 0,
      cost_price: input.costPrice ?? 0,
      minimum_stock: input.minimumStock ?? 0,
      maximum_stock: input.maximumStock ?? 0,
      reorder_level: input.reorderLevel ?? 0,
      safety_stock: input.safetyStock ?? 0,
      tracks_serial_numbers: input.tracksSerialNumbers ?? false,
      tracks_lot_numbers: input.tracksLotNumbers ?? false,
      has_expiry_date: input.hasExpiryDate ?? false,
      vat_treatment_code: input.vatTreatmentCode ?? "",
      notes: input.notes ?? "",
    })
    .select("*")
    .single<StockItemRow>();
  if (error) throw error;
  return stockItemFromRow(data);
}

export async function updateStockItem(companyId: string, stockItemId: number, fields: Partial<NewStockItem>): Promise<StockItem> {
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (fields.barcode !== undefined) payload.barcode = fields.barcode;
  if (fields.description !== undefined) payload.description = fields.description;
  if (fields.longDescription !== undefined) payload.long_description = fields.longDescription;
  if (fields.category !== undefined) payload.category = fields.category;
  if (fields.subcategory !== undefined) payload.subcategory = fields.subcategory;
  if (fields.brand !== undefined) payload.brand = fields.brand;
  if (fields.unitOfMeasure !== undefined) payload.unit_of_measure = fields.unitOfMeasure;
  if (fields.alternativeUnit !== undefined) payload.alternative_unit = fields.alternativeUnit;
  if (fields.alternativeUnitFactor !== undefined) payload.alternative_unit_factor = fields.alternativeUnitFactor;
  if (fields.defaultWarehouseId !== undefined) payload.default_warehouse_id = fields.defaultWarehouseId;
  if (fields.defaultLocationId !== undefined) payload.default_location_id = fields.defaultLocationId;
  if (fields.preferredSupplierId !== undefined) payload.preferred_supplier_id = fields.preferredSupplierId;
  if (fields.sellingPrice !== undefined) payload.selling_price = fields.sellingPrice;
  if (fields.costPrice !== undefined) payload.cost_price = fields.costPrice;
  if (fields.minimumStock !== undefined) payload.minimum_stock = fields.minimumStock;
  if (fields.maximumStock !== undefined) payload.maximum_stock = fields.maximumStock;
  if (fields.reorderLevel !== undefined) payload.reorder_level = fields.reorderLevel;
  if (fields.safetyStock !== undefined) payload.safety_stock = fields.safetyStock;
  if (fields.tracksSerialNumbers !== undefined) payload.tracks_serial_numbers = fields.tracksSerialNumbers;
  if (fields.tracksLotNumbers !== undefined) payload.tracks_lot_numbers = fields.tracksLotNumbers;
  if (fields.hasExpiryDate !== undefined) payload.has_expiry_date = fields.hasExpiryDate;
  if (fields.vatTreatmentCode !== undefined) payload.vat_treatment_code = fields.vatTreatmentCode;
  if (fields.notes !== undefined) payload.notes = fields.notes;

  const { data, error } = await supabase
    .from("stock_items")
    .update(payload)
    .eq("company_id", companyId)
    .eq("id", stockItemId)
    .select("*")
    .single<StockItemRow>();
  if (error) throw error;
  return stockItemFromRow(data);
}

export async function setStockItemStatus(companyId: string, stockItemId: number, status: StockItemStatus): Promise<StockItem> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .update({ status })
    .eq("company_id", companyId)
    .eq("id", stockItemId)
    .select("*")
    .single<StockItemRow>();
  if (error) throw error;
  return stockItemFromRow(data);
}

/** The one function that changes the maintained running counters —
 * always called with values the pure costing engine already computed. */
export async function setStockLevels(companyId: string, stockItemId: number, quantityOnHand: number, averageCost: number): Promise<StockItem> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .update({ quantity_on_hand: quantityOnHand, average_cost: averageCost })
    .eq("company_id", companyId)
    .eq("id", stockItemId)
    .select("*")
    .single<StockItemRow>();
  if (error) throw error;
  return stockItemFromRow(data);
}
