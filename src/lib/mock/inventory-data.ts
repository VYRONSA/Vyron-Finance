/**
 * Preview Mode seed data for the Inventory Platform (Commercial
 * Platform, Module 5). Field shapes match the real domain types exactly.
 * Deliberately spans five real scenarios: normal/fast-moving stock, low
 * stock (at the reorder level), out of stock, dead stock (on hand but
 * not sold in 180+ days), and a Received/Posted Goods Received
 * transaction — enough for `buildInventoryDashboardSummary` and
 * `buildStockItemIntelligence` to have real, varied data to compute
 * from, not a single uniform "everything is fine" scenario.
 */

import type {
  IntegrationConnection,
  InventoryTransaction,
  StockItem,
  StockTake,
  Warehouse,
  WarehouseLocation,
} from "@/server/inventory/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_WAREHOUSES: Warehouse[] = [
  { id: 1, companyId: COMPANY_ID, code: "MAIN", name: "Main Warehouse", address: "12 Industrial Ave, Johannesburg", isActive: true, isDefault: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, code: "OVERFLOW", name: "Overflow Storage", address: "8 Depot Road, Johannesburg", isActive: true, isDefault: false, createdAt: "2025-01-14T09:00:00Z" },
];

export const MOCK_WAREHOUSE_LOCATIONS: WarehouseLocation[] = [
  { id: 1, warehouseId: 1, code: "A1", description: "Aisle A, Bay 1", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, warehouseId: 1, code: "A2", description: "Aisle A, Bay 2", isActive: true, createdAt: "2025-01-14T09:00:00Z" },
];

export const MOCK_STOCK_ITEMS: StockItem[] = [
  {
    id: 1, companyId: COMPANY_ID, stockCode: "SKU-1000", barcode: "6001234500019", description: "A4 Copy Paper (Box of 5 Reams)",
    longDescription: "80gsm white A4 copy paper, 5 reams per box.", category: "Office Supplies", subcategory: "Paper", brand: "Typek",
    unitOfMeasure: "Box", alternativeUnit: "Ream", alternativeUnitFactor: 5, defaultWarehouseId: 1, defaultLocationId: 1,
    preferredSupplierId: 1, sellingPrice: 450, costPrice: 280, quantityOnHand: 60, averageCost: 285, minimumStock: 10,
    maximumStock: 200, reorderLevel: 20, safetyStock: 10, tracksSerialNumbers: false, tracksLotNumbers: false, hasExpiryDate: false,
    vatTreatmentCode: "Standard Rated", status: "Active", notes: "", createdAt: "2025-01-14T09:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, stockCode: "SKU-1001", barcode: "6001234500026", description: "Toner Cartridge — HP304",
    longDescription: "", category: "Office Supplies", subcategory: "Printer Consumables", brand: "HP",
    unitOfMeasure: "Each", alternativeUnit: "", alternativeUnitFactor: 1, defaultWarehouseId: 1, defaultLocationId: 2,
    preferredSupplierId: 1, sellingPrice: 890, costPrice: 610, quantityOnHand: 5, averageCost: 615, minimumStock: 2,
    maximumStock: 30, reorderLevel: 5, safetyStock: 2, tracksSerialNumbers: false, tracksLotNumbers: false, hasExpiryDate: false,
    vatTreatmentCode: "Standard Rated", status: "Active", notes: "", createdAt: "2025-01-14T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, stockCode: "SKU-1002", barcode: "6001234500033", description: "Desk Lamp — LED",
    longDescription: "", category: "Furniture", subcategory: "Lighting", brand: "Eurolux",
    unitOfMeasure: "Each", alternativeUnit: "", alternativeUnitFactor: 1, defaultWarehouseId: 1, defaultLocationId: null,
    preferredSupplierId: 2, sellingPrice: 320, costPrice: 190, quantityOnHand: 0, averageCost: 190, minimumStock: 5,
    maximumStock: 50, reorderLevel: 8, safetyStock: 0, tracksSerialNumbers: false, tracksLotNumbers: false, hasExpiryDate: false,
    vatTreatmentCode: "Standard Rated", status: "Active", notes: "", createdAt: "2025-01-14T09:00:00Z",
  },
  {
    id: 4, companyId: COMPANY_ID, stockCode: "SKU-1003", barcode: "6001234500040", description: "Legacy Desktop Fax Machine",
    longDescription: "", category: "Office Equipment", subcategory: "Legacy", brand: "Brother",
    unitOfMeasure: "Each", alternativeUnit: "", alternativeUnitFactor: 1, defaultWarehouseId: 2, defaultLocationId: null,
    preferredSupplierId: null, sellingPrice: 1500, costPrice: 900, quantityOnHand: 3, averageCost: 900, minimumStock: 0,
    maximumStock: 10, reorderLevel: 0, safetyStock: 0, tracksSerialNumbers: true, tracksLotNumbers: false, hasExpiryDate: false,
    vatTreatmentCode: "Standard Rated", status: "Active", notes: "Discontinued product line — carried for legacy support only.", createdAt: "2024-03-01T09:00:00Z",
  },
];

export const MOCK_INVENTORY_TRANSACTIONS: InventoryTransaction[] = [
  {
    id: 1, companyId: COMPANY_ID, transactionType: "Receipt", transactionNumber: "REC000001", transactionDate: "2026-06-01",
    warehouseId: 1, destinationWarehouseId: null, status: "Posted", reference: "PO000001", notes: "Goods received: SKU-1000",
    sourceType: "goods_received_note", sourceId: 1, direction: null, journalId: null, createdAt: "2026-06-01T09:00:00Z",
    submittedBy: "warehouse@fenwickrowe.co.za", submittedAt: "2026-06-01T09:00:00Z", approvedBy: "warehouse@fenwickrowe.co.za",
    approvedAt: "2026-06-01T09:00:05Z", postedAt: "2026-06-01T09:00:10Z", cancelledBy: null, cancelledAt: null,
    lines: [{ id: 1, transactionId: 1, lineOrder: 0, stockItemId: 1, quantity: 40, unitCost: 285, serialNumber: "", lotNumber: "", expiryDate: null, notes: "" }],
  },
  {
    id: 2, companyId: COMPANY_ID, transactionType: "Issue", transactionNumber: "ISS000001", transactionDate: "2026-07-20",
    warehouseId: 1, destinationWarehouseId: null, status: "Posted", reference: "INV000010", notes: "Sales Invoice INV000010: SKU-1000",
    sourceType: "sales_invoice", sourceId: 10, direction: null, journalId: null, createdAt: "2026-07-20T09:00:00Z",
    submittedBy: "sales@fenwickrowe.co.za", submittedAt: "2026-07-20T09:00:00Z", approvedBy: "sales@fenwickrowe.co.za",
    approvedAt: "2026-07-20T09:00:05Z", postedAt: "2026-07-20T09:00:10Z", cancelledBy: null, cancelledAt: null,
    lines: [{ id: 2, transactionId: 2, lineOrder: 0, stockItemId: 1, quantity: 5, unitCost: 285, serialNumber: "", lotNumber: "", expiryDate: null, notes: "" }],
  },
  {
    id: 3, companyId: COMPANY_ID, transactionType: "Issue", transactionNumber: "ISS000002", transactionDate: "2026-07-25",
    warehouseId: 1, destinationWarehouseId: null, status: "Posted", reference: "INV000011", notes: "Sales Invoice INV000011: SKU-1000",
    sourceType: "sales_invoice", sourceId: 11, direction: null, journalId: null, createdAt: "2026-07-25T09:00:00Z",
    submittedBy: "sales@fenwickrowe.co.za", submittedAt: "2026-07-25T09:00:00Z", approvedBy: "sales@fenwickrowe.co.za",
    approvedAt: "2026-07-25T09:00:05Z", postedAt: "2026-07-25T09:00:10Z", cancelledBy: null, cancelledAt: null,
    lines: [{ id: 3, transactionId: 3, lineOrder: 0, stockItemId: 1, quantity: 3, unitCost: 285, serialNumber: "", lotNumber: "", expiryDate: null, notes: "" }],
  },
];

export const MOCK_STOCK_TAKES: StockTake[] = [
  {
    id: 1, companyId: COMPANY_ID, stockTakeNumber: "ST000001", warehouseId: 1, countDate: "2026-06-30",
    status: "Finalized", notes: "Quarter-end count", createdAt: "2026-06-30T09:00:00Z",
    finalizedBy: "warehouse@fenwickrowe.co.za", finalizedAt: "2026-06-30T15:00:00Z",
    lines: [
      { id: 1, stockTakeId: 1, stockItemId: 1, systemQuantity: 62, countedQuantity: 60 },
      { id: 2, stockTakeId: 1, stockItemId: 2, systemQuantity: 5, countedQuantity: 5 },
    ],
  },
];

export const MOCK_INTEGRATION_CONNECTIONS: IntegrationConnection[] = [
  { id: 1, companyId: COMPANY_ID, systemName: "VYRON_COST", status: "Not Connected", lastSyncedAt: null, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, systemName: "VYRON_CORE", status: "Not Connected", lastSyncedAt: null, notes: "", createdAt: "2025-01-14T09:00:00Z" },
];
