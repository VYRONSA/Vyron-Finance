/**
 * Repository layer for Warehouses and Warehouse Locations — no
 * accounting impact. Mirrors `department-repository.ts`'s shape, plus
 * `is_default` (only one warehouse per company should carry it — the
 * service layer enforces that, not a DB constraint, mirroring how
 * address `is_default` flags are enforced application-side elsewhere).
 */

import { createClient } from "@/lib/supabase/server";
import { warehouseFromRow, warehouseLocationFromRow, type WarehouseLocationRow, type WarehouseRow } from "@/server/inventory/mappers";
import type { Warehouse, WarehouseLocation } from "@/server/inventory/types";

export async function listWarehouses(companyId: string): Promise<Warehouse[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouses").select("*").eq("company_id", companyId).order("name").returns<WarehouseRow[]>();
  if (error) throw error;
  return data.map(warehouseFromRow);
}

export async function getWarehouse(companyId: string, warehouseId: number): Promise<Warehouse | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", warehouseId)
    .maybeSingle<WarehouseRow>();
  if (error) throw error;
  return data ? warehouseFromRow(data) : null;
}

export type NewWarehouse = { code: string; name: string; address?: string; isDefault?: boolean };

export async function createWarehouse(companyId: string, input: NewWarehouse): Promise<Warehouse> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .insert({ company_id: companyId, code: input.code, name: input.name, address: input.address ?? "", is_default: input.isDefault ?? false })
    .select("*")
    .single<WarehouseRow>();
  if (error) throw error;
  return warehouseFromRow(data);
}

export async function updateWarehouse(companyId: string, warehouseId: number, fields: Partial<{ name: string; address: string; isDefault: boolean }>): Promise<Warehouse> {
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.address !== undefined) payload.address = fields.address;
  if (fields.isDefault !== undefined) payload.is_default = fields.isDefault;
  const { data, error } = await supabase
    .from("warehouses")
    .update(payload)
    .eq("company_id", companyId)
    .eq("id", warehouseId)
    .select("*")
    .single<WarehouseRow>();
  if (error) throw error;
  return warehouseFromRow(data);
}

export async function clearOtherDefaultWarehouses(companyId: string, exceptWarehouseId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("warehouses").update({ is_default: false }).eq("company_id", companyId).neq("id", exceptWarehouseId);
  if (error) throw error;
}

export async function setWarehouseActive(companyId: string, warehouseId: number, isActive: boolean): Promise<Warehouse> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .update({ is_active: isActive })
    .eq("company_id", companyId)
    .eq("id", warehouseId)
    .select("*")
    .single<WarehouseRow>();
  if (error) throw error;
  return warehouseFromRow(data);
}

export async function listWarehouseLocations(warehouseId: number): Promise<WarehouseLocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_locations")
    .select("*")
    .eq("warehouse_id", warehouseId)
    .order("code")
    .returns<WarehouseLocationRow[]>();
  if (error) throw error;
  return data.map(warehouseLocationFromRow);
}

export type NewWarehouseLocation = { code: string; description?: string };

export async function createWarehouseLocation(warehouseId: number, input: NewWarehouseLocation): Promise<WarehouseLocation> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_locations")
    .insert({ warehouse_id: warehouseId, code: input.code, description: input.description ?? "" })
    .select("*")
    .single<WarehouseLocationRow>();
  if (error) throw error;
  return warehouseLocationFromRow(data);
}
