/**
 * VYRON COST — AI Cost Intelligence Platform. Owns Procurement/Supplier/
 * Inventory/Manufacturing Intelligence, Recipe Costing, Bill of
 * Materials, Production Costing, Stock Intelligence, Purchase Price
 * Analysis, Cost Variance Analysis, Manufacturing Planning, Yield
 * Analysis, Margin Intelligence — it is the operational costing engine,
 * not an accounting system. Per the Product Review Board's Phase 4
 * directive, all accounting entries remain inside VYRON FINANCE; VYRON
 * COST never posts directly to the General Ledger, it only supplies
 * validated operational events. These are the ten named event types in
 * that directive's own event chain — VYRON FINANCE performs the
 * accounting for each once a real connection exists.
 *
 * See `event-contract.ts` for why this is a type-only architecture file
 * (no transport, no sync, no mock/seeded data).
 */

import type { IntegrationBusinessEvent } from "./event-contract";

export type VyronCostEventType =
  | "vyron_cost.inventory_movement.v1"
  | "vyron_cost.inventory_valuation.v1"
  | "vyron_cost.cost_of_sale.v1"
  | "vyron_cost.stock_adjustment.v1"
  | "vyron_cost.manufacturing_journal.v1"
  | "vyron_cost.purchase_receipt.v1"
  | "vyron_cost.finished_goods_valuation.v1"
  | "vyron_cost.raw_material_consumption.v1"
  | "vyron_cost.standard_cost_update.v1"
  | "vyron_cost.actual_cost_variance.v1";

export type InventoryMovementPayload = {
  stockItemReference: string;
  warehouseReference: string;
  movementType: "Receipt" | "Issue" | "Adjustment" | "Transfer";
  quantity: number;
  unitCost: number;
  referenceNumber: string;
  transactionDate: string;
};

export type InventoryValuationPayload = {
  stockItemReference: string;
  warehouseReference: string;
  quantityOnHand: number;
  valuationMethod: "Standard" | "Actual" | "WeightedAverage";
  unitValue: number;
  totalValue: number;
  asOfDate: string;
};

export type CostOfSalePayload = {
  salesInvoiceReference: string;
  stockItemReference: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  transactionDate: string;
};

export type StockAdjustmentPayload = {
  stockItemReference: string;
  warehouseReference: string;
  quantityDelta: number;
  unitCost: number;
  reason: string;
  transactionDate: string;
};

export type ManufacturingJournalPayload = {
  productionOrderReference: string;
  rawMaterialsConsumedValue: number;
  labourAllocatedValue: number;
  overheadAllocatedValue: number;
  finishedGoodsValue: number;
  transactionDate: string;
};

export type PurchaseReceiptPayload = {
  purchaseOrderReference: string;
  supplierReference: string;
  stockItemReference: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
  receivedDate: string;
};

export type FinishedGoodsValuationPayload = {
  stockItemReference: string;
  warehouseReference: string;
  quantityOnHand: number;
  unitValue: number;
  totalValue: number;
  asOfDate: string;
};

export type RawMaterialConsumptionPayload = {
  productionOrderReference: string;
  stockItemReference: string;
  quantityConsumed: number;
  unitCost: number;
  totalCost: number;
  transactionDate: string;
};

export type StandardCostUpdatePayload = {
  stockItemReference: string;
  previousStandardCost: number;
  newStandardCost: number;
  effectiveDate: string;
};

export type ActualCostVariancePayload = {
  productionOrderReference: string;
  stockItemReference: string;
  standardCost: number;
  actualCost: number;
  varianceAmount: number;
  varianceReason: string;
  transactionDate: string;
};

export type VyronCostEvent =
  | IntegrationBusinessEvent<"vyron_cost.inventory_movement.v1", InventoryMovementPayload>
  | IntegrationBusinessEvent<"vyron_cost.inventory_valuation.v1", InventoryValuationPayload>
  | IntegrationBusinessEvent<"vyron_cost.cost_of_sale.v1", CostOfSalePayload>
  | IntegrationBusinessEvent<"vyron_cost.stock_adjustment.v1", StockAdjustmentPayload>
  | IntegrationBusinessEvent<"vyron_cost.manufacturing_journal.v1", ManufacturingJournalPayload>
  | IntegrationBusinessEvent<"vyron_cost.purchase_receipt.v1", PurchaseReceiptPayload>
  | IntegrationBusinessEvent<"vyron_cost.finished_goods_valuation.v1", FinishedGoodsValuationPayload>
  | IntegrationBusinessEvent<"vyron_cost.raw_material_consumption.v1", RawMaterialConsumptionPayload>
  | IntegrationBusinessEvent<"vyron_cost.standard_cost_update.v1", StandardCostUpdatePayload>
  | IntegrationBusinessEvent<"vyron_cost.actual_cost_variance.v1", ActualCostVariancePayload>;

/** The one lookup a future VYRON COST event handler needs: which
 * `posting_rules.event_type` (migration 0007) a company's own rule is
 * configured under for this event. Pure and exhaustive — a new
 * `VyronCostEventType` member fails `tsc`, not silently falls through,
 * matching this codebase's established pattern for event-type dispatch
 * (see `posting-rule-service.ts`). */
export function postingEventTypeForVyronCostEvent(eventType: VyronCostEventType): string {
  switch (eventType) {
    case "vyron_cost.inventory_movement.v1":
      return "VYRON COST Inventory Movement";
    case "vyron_cost.inventory_valuation.v1":
      return "VYRON COST Inventory Valuation";
    case "vyron_cost.cost_of_sale.v1":
      return "VYRON COST Cost of Sale";
    case "vyron_cost.stock_adjustment.v1":
      return "VYRON COST Stock Adjustment";
    case "vyron_cost.manufacturing_journal.v1":
      return "VYRON COST Manufacturing Journal";
    case "vyron_cost.purchase_receipt.v1":
      return "VYRON COST Purchase Receipt";
    case "vyron_cost.finished_goods_valuation.v1":
      return "VYRON COST Finished Goods Valuation";
    case "vyron_cost.raw_material_consumption.v1":
      return "VYRON COST Raw Material Consumption";
    case "vyron_cost.standard_cost_update.v1":
      return "VYRON COST Standard Cost Update";
    case "vyron_cost.actual_cost_variance.v1":
      return "VYRON COST Actual Cost Variance";
  }
}
