/**
 * Row <-> domain type mappers for the Inventory Platform (see
 * supabase/migrations/0012_inventory_platform.sql).
 */

import type {
  IntegrationConnection,
  IntegrationStatus,
  IntegrationSystemName,
  InventoryTransaction,
  InventoryTransactionLine,
  InventoryTransactionStatus,
  InventoryTransactionType,
  StockCostLayer,
  StockItem,
  StockItemStatus,
  StockTake,
  StockTakeLine,
  StockTakeStatus,
  Warehouse,
  WarehouseLocation,
} from "./types";

export type WarehouseRow = {
  id: number;
  company_id: string;
  code: string;
  name: string;
  address: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
};

export function warehouseFromRow(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    address: row.address,
    isActive: row.is_active,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

export type WarehouseLocationRow = {
  id: number;
  warehouse_id: number;
  code: string;
  description: string;
  is_active: boolean;
  created_at: string;
};

export function warehouseLocationFromRow(row: WarehouseLocationRow): WarehouseLocation {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    code: row.code,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export type StockItemRow = {
  id: number;
  company_id: string;
  stock_code: string;
  barcode: string;
  description: string;
  long_description: string;
  category: string;
  subcategory: string;
  brand: string;
  unit_of_measure: string;
  alternative_unit: string;
  alternative_unit_factor: number;
  default_warehouse_id: number | null;
  default_location_id: number | null;
  preferred_supplier_id: number | null;
  selling_price: number;
  cost_price: number;
  quantity_on_hand: number;
  average_cost: number;
  minimum_stock: number;
  maximum_stock: number;
  reorder_level: number;
  safety_stock: number;
  tracks_serial_numbers: boolean;
  tracks_lot_numbers: boolean;
  has_expiry_date: boolean;
  vat_treatment_code: string;
  status: string;
  notes: string;
  created_at: string;
};

export function stockItemFromRow(row: StockItemRow): StockItem {
  return {
    id: row.id,
    companyId: row.company_id,
    stockCode: row.stock_code,
    barcode: row.barcode,
    description: row.description,
    longDescription: row.long_description,
    category: row.category,
    subcategory: row.subcategory,
    brand: row.brand,
    unitOfMeasure: row.unit_of_measure,
    alternativeUnit: row.alternative_unit,
    alternativeUnitFactor: Number(row.alternative_unit_factor),
    defaultWarehouseId: row.default_warehouse_id,
    defaultLocationId: row.default_location_id,
    preferredSupplierId: row.preferred_supplier_id,
    sellingPrice: Number(row.selling_price),
    costPrice: Number(row.cost_price),
    quantityOnHand: Number(row.quantity_on_hand),
    averageCost: Number(row.average_cost),
    minimumStock: Number(row.minimum_stock),
    maximumStock: Number(row.maximum_stock),
    reorderLevel: Number(row.reorder_level),
    safetyStock: Number(row.safety_stock),
    tracksSerialNumbers: row.tracks_serial_numbers,
    tracksLotNumbers: row.tracks_lot_numbers,
    hasExpiryDate: row.has_expiry_date,
    vatTreatmentCode: row.vat_treatment_code,
    status: row.status as StockItemStatus,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type StockCostLayerRow = {
  id: number;
  company_id: string;
  stock_item_id: number;
  warehouse_id: number;
  received_date: string;
  quantity_remaining: number;
  unit_cost: number;
  created_at: string;
};

export function stockCostLayerFromRow(row: StockCostLayerRow): StockCostLayer {
  return {
    id: row.id,
    companyId: row.company_id,
    stockItemId: row.stock_item_id,
    warehouseId: row.warehouse_id,
    receivedDate: row.received_date,
    quantityRemaining: Number(row.quantity_remaining),
    unitCost: Number(row.unit_cost),
    createdAt: row.created_at,
  };
}

export type InventoryTransactionLineRow = {
  id: number;
  transaction_id: number;
  line_order: number;
  stock_item_id: number;
  quantity: number;
  unit_cost: number;
  serial_number: string;
  lot_number: string;
  expiry_date: string | null;
  notes: string;
};

export function inventoryTransactionLineFromRow(row: InventoryTransactionLineRow): InventoryTransactionLine {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    lineOrder: row.line_order,
    stockItemId: row.stock_item_id,
    quantity: Number(row.quantity),
    unitCost: Number(row.unit_cost),
    serialNumber: row.serial_number,
    lotNumber: row.lot_number,
    expiryDate: row.expiry_date,
    notes: row.notes,
  };
}

export type InventoryTransactionRow = {
  id: number;
  company_id: string;
  transaction_type: string;
  transaction_number: string;
  transaction_date: string;
  warehouse_id: number;
  destination_warehouse_id: number | null;
  status: string;
  reference: string;
  notes: string;
  source_type: string;
  source_id: number | null;
  direction: string | null;
  journal_id: number | null;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  inventory_transaction_lines?: InventoryTransactionLineRow[];
};

export function inventoryTransactionFromRow(row: InventoryTransactionRow): InventoryTransaction {
  return {
    id: row.id,
    companyId: row.company_id,
    transactionType: row.transaction_type as InventoryTransactionType,
    transactionNumber: row.transaction_number,
    transactionDate: row.transaction_date,
    warehouseId: row.warehouse_id,
    destinationWarehouseId: row.destination_warehouse_id,
    status: row.status as InventoryTransactionStatus,
    reference: row.reference,
    notes: row.notes,
    sourceType: row.source_type,
    sourceId: row.source_id,
    direction: row.direction as InventoryTransaction["direction"],
    journalId: row.journal_id,
    createdAt: row.created_at,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
    lines: (row.inventory_transaction_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(inventoryTransactionLineFromRow),
  };
}

export type StockTakeLineRow = {
  id: number;
  stock_take_id: number;
  stock_item_id: number;
  system_quantity: number;
  counted_quantity: number;
};

export function stockTakeLineFromRow(row: StockTakeLineRow): StockTakeLine {
  return {
    id: row.id,
    stockTakeId: row.stock_take_id,
    stockItemId: row.stock_item_id,
    systemQuantity: Number(row.system_quantity),
    countedQuantity: Number(row.counted_quantity),
  };
}

export type StockTakeRow = {
  id: number;
  company_id: string;
  stock_take_number: string;
  warehouse_id: number;
  count_date: string;
  status: string;
  notes: string;
  created_at: string;
  finalized_by: string | null;
  finalized_at: string | null;
  stock_take_lines?: StockTakeLineRow[];
};

export function stockTakeFromRow(row: StockTakeRow): StockTake {
  return {
    id: row.id,
    companyId: row.company_id,
    stockTakeNumber: row.stock_take_number,
    warehouseId: row.warehouse_id,
    countDate: row.count_date,
    status: row.status as StockTakeStatus,
    notes: row.notes,
    createdAt: row.created_at,
    finalizedBy: row.finalized_by,
    finalizedAt: row.finalized_at,
    lines: (row.stock_take_lines ?? []).map(stockTakeLineFromRow),
  };
}

export type IntegrationConnectionRow = {
  id: number;
  company_id: string;
  system_name: string;
  status: string;
  last_synced_at: string | null;
  notes: string;
  created_at: string;
};

export function integrationConnectionFromRow(row: IntegrationConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    companyId: row.company_id,
    systemName: row.system_name as IntegrationSystemName,
    status: row.status as IntegrationStatus,
    lastSyncedAt: row.last_synced_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}
