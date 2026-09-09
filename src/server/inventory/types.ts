/**
 * Domain types for the Inventory Platform (Commercial Platform, Module
 * 5 — non-manufacturing). See supabase/migrations/0012_inventory_platform.sql.
 * Genuinely new — no reference-app equivalent, and manufacturing is
 * explicitly out of scope (belongs to VYRON COST).
 */

export type StockItemStatus = "Active" | "Inactive" | "Discontinued";

export type Warehouse = {
  id: number;
  companyId: string;
  code: string;
  name: string;
  address: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
};

export type WarehouseLocation = {
  id: number;
  warehouseId: number;
  code: string;
  description: string;
  isActive: boolean;
  createdAt: string;
};

export type StockItem = {
  id: number;
  companyId: string;
  stockCode: string;
  barcode: string;
  description: string;
  longDescription: string;
  category: string;
  subcategory: string;
  brand: string;
  unitOfMeasure: string;
  alternativeUnit: string;
  alternativeUnitFactor: number;
  defaultWarehouseId: number | null;
  defaultLocationId: number | null;
  preferredSupplierId: number | null;
  sellingPrice: number;
  costPrice: number;
  quantityOnHand: number;
  averageCost: number;
  minimumStock: number;
  maximumStock: number;
  reorderLevel: number;
  safetyStock: number;
  tracksSerialNumbers: boolean;
  tracksLotNumbers: boolean;
  hasExpiryDate: boolean;
  vatTreatmentCode: string;
  status: StockItemStatus;
  notes: string;
  createdAt: string;
};

export type StockCostLayer = {
  id: number;
  companyId: string;
  stockItemId: number;
  warehouseId: number;
  receivedDate: string;
  quantityRemaining: number;
  unitCost: number;
  createdAt: string;
};

export type InventoryTransactionType = "Receipt" | "Issue" | "Transfer" | "Adjustment" | "StockTake" | "Return" | "WriteOff" | "OpeningBalance";
export type InventoryTransactionStatus = "Draft" | "Submitted" | "Approved" | "Posted" | "Cancelled";

export type InventoryTransaction = {
  id: number;
  companyId: string;
  transactionType: InventoryTransactionType;
  transactionNumber: string;
  transactionDate: string;
  warehouseId: number;
  destinationWarehouseId: number | null;
  status: InventoryTransactionStatus;
  reference: string;
  notes: string;
  sourceType: string;
  sourceId: number | null;
  /** Only meaningful for `transactionType === "Adjustment"` — see the
   * migration's own column comment. */
  direction: "Increase" | "Decrease" | null;
  journalId: number | null;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: InventoryTransactionLine[];
};

export type InventoryTransactionLine = {
  id: number;
  transactionId: number;
  lineOrder: number;
  stockItemId: number;
  quantity: number;
  unitCost: number;
  serialNumber: string;
  lotNumber: string;
  expiryDate: string | null;
  notes: string;
};

export type StockTakeStatus = "Draft" | "Finalized" | "Cancelled";

export type StockTake = {
  id: number;
  companyId: string;
  stockTakeNumber: string;
  warehouseId: number;
  countDate: string;
  status: StockTakeStatus;
  notes: string;
  createdAt: string;
  finalizedBy: string | null;
  finalizedAt: string | null;
  lines: StockTakeLine[];
};

export type StockTakeLine = {
  id: number;
  stockTakeId: number;
  stockItemId: number;
  systemQuantity: number;
  countedQuantity: number;
};

export type IntegrationSystemName = "VYRON_COST" | "VYRON_CORE";
export type IntegrationStatus = "Not Connected" | "Connected" | "Error";

export type IntegrationConnection = {
  id: number;
  companyId: string;
  systemName: IntegrationSystemName;
  status: IntegrationStatus;
  lastSyncedAt: string | null;
  notes: string;
  createdAt: string;
};
