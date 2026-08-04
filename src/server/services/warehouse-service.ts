/**
 * Service layer for Warehouses and Warehouse Locations. No accounting
 * impact. Only one warehouse per company may be the default — enforced
 * here (application-side), not by a DB constraint, matching how address
 * `is_default` flags are enforced elsewhere in this codebase.
 */

import * as repo from "@/server/repositories/warehouse-repository";
import type { Warehouse, WarehouseLocation } from "@/server/inventory/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listWarehouses = repo.listWarehouses;
export const getWarehouse = repo.getWarehouse;
export const listWarehouseLocations = repo.listWarehouseLocations;

export async function createWarehouse(companyId: string, input: repo.NewWarehouse): Promise<Warehouse> {
  if (!input.code?.trim()) throw new ValidationError("Warehouse code is required.");
  if (!input.name?.trim()) throw new ValidationError("Warehouse name is required.");
  const warehouse = await repo.createWarehouse(companyId, input);
  if (warehouse.isDefault) await repo.clearOtherDefaultWarehouses(companyId, warehouse.id);
  return warehouse;
}

export async function updateWarehouse(companyId: string, warehouseId: number, fields: Parameters<typeof repo.updateWarehouse>[2]): Promise<Warehouse> {
  const warehouse = await repo.updateWarehouse(companyId, warehouseId, fields);
  if (fields.isDefault) await repo.clearOtherDefaultWarehouses(companyId, warehouseId);
  return warehouse;
}

export async function setDefaultWarehouse(companyId: string, warehouseId: number): Promise<Warehouse> {
  const warehouse = await repo.getWarehouse(companyId, warehouseId);
  if (!warehouse) throw new NotFoundError(`No warehouse with id ${warehouseId}.`);
  const updated = await repo.updateWarehouse(companyId, warehouseId, { isDefault: true });
  await repo.clearOtherDefaultWarehouses(companyId, warehouseId);
  return updated;
}

export const setWarehouseActive = repo.setWarehouseActive;

export async function createWarehouseLocation(warehouseId: number, input: repo.NewWarehouseLocation): Promise<WarehouseLocation> {
  if (!input.code?.trim()) throw new ValidationError("Location code is required.");
  return repo.createWarehouseLocation(warehouseId, input);
}
