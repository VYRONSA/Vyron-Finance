/**
 * Service layer for Purchase Orders. No accounting impact — validation,
 * status workflow, and the real Requisition -> Order conversion (copies
 * lines, links back via `requisitionId`, marks the source requisition
 * Converted). Mirrors `sales-order-service.ts` exactly.
 */

import * as repo from "@/server/repositories/purchase-order-repository";
import * as requisitionRepo from "@/server/repositories/purchase-requisition-repository";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { computeLineAmounts } from "@/server/purchasing/line-amounts";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/server/purchasing/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Rejected", "Cancelled"],
  Approved: ["PartiallyReceived", "Received", "Cancelled"],
  Rejected: [],
  PartiallyReceived: ["Received", "Cancelled"],
  Received: ["Billed"],
  Billed: [],
  Cancelled: [],
};

export function canTransitionOrderStatus(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateOrderLines(lines: { description: string; quantity: number; unitPrice: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A purchase order needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    if (line.unitPrice < 0) throw new ValidationError("Unit price cannot be negative.");
  }
}

export const listPurchaseOrders = repo.listPurchaseOrders;
export const listPurchaseOrdersBySupplier = repo.listPurchaseOrdersBySupplier;
export const getPurchaseOrder = repo.getPurchaseOrder;

/** Pure — exported for direct unit testing (same convention as
 * `purchase-bill-service.ts::computeBillLine`, which shares this same
 * `computeLineAmounts` core). GL account/VAT code stay optional here —
 * unlike a Bill, a Purchase Order's own accounting dimensions are
 * budgetary/commitment data (POs never post to the GL, by design), not
 * a posting requirement — a line with neither is still a valid PO line. */
export function computeOrderLine<T extends { quantity: number; unitPrice: number; discount?: number }>(line: T, vatRatePercent: number): T & { discount: number; netAmount: number; vatAmount: number } {
  const discount = line.discount ?? 0;
  const { netAmount, vatAmount } = computeLineAmounts(line.quantity, line.unitPrice, discount, vatRatePercent);
  return { ...line, discount, netAmount, vatAmount };
}

async function computeOrderLines(companyId: string, lines: repo.NewPurchaseOrderLine[]) {
  const vatTreatments = await listVatTreatments(companyId);
  return lines.map((line) => {
    if (line.vatCode && !vatTreatments.some((t) => t.code === line.vatCode)) {
      throw new ValidationError(`Unknown VAT treatment "${line.vatCode}".`);
    }
    const rate = line.vatCode ? (vatTreatments.find((t) => t.code === line.vatCode)?.rate ?? 0) : 0;
    return computeOrderLine(line, rate);
  });
}

export async function createPurchaseOrder(companyId: string, input: repo.NewPurchaseOrder): Promise<PurchaseOrder> {
  if (!input.supplierId) throw new ValidationError("Supplier is required.");
  if (!input.orderDate) throw new ValidationError("Order date is required.");
  validateOrderLines(input.lines);

  const computedLines = await computeOrderLines(companyId, input.lines);
  return repo.createPurchaseOrder(companyId, { ...input, lines: computedLines });
}

/** Product Review Board certification — "Correct editing," parity with
 * `purchase-bill-service.ts::updateBillLines`. Only a Draft order can
 * be edited: Submitted is already in the approval workflow, and once
 * Approved/Received a GRN or Bill may already reference the order's
 * lines by id (`goods_received_note_lines.order_line_id`,
 * `received_quantity`/`billed_quantity`) — replacing the line set past
 * that point would orphan or silently reset real fulfillment history. */
export async function updateOrderLines(companyId: string, orderId: number, lines: repo.NewPurchaseOrderLine[]): Promise<PurchaseOrder> {
  const order = await repo.getPurchaseOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No purchase order with id ${orderId}.`);
  if (order.status !== "Draft") {
    throw new ValidationError(`Only a Draft order can be edited (current status: ${order.status}).`);
  }
  validateOrderLines(lines);

  const computedLines = await computeOrderLines(companyId, lines);
  return repo.replaceOrderLines(companyId, orderId, computedLines);
}

/** Real conversion — copies the requisition's own lines (estimated
 * prices carry over as starting unit prices) rather than asking the
 * caller to re-key them, and marks the source requisition Converted so
 * it can't be converted twice. */
export async function createOrderFromRequisition(companyId: string, requisitionId: number, supplierId: number, orderDate: string): Promise<PurchaseOrder> {
  const requisition = await requisitionRepo.getPurchaseRequisition(companyId, requisitionId);
  if (!requisition) throw new NotFoundError(`No purchase requisition with id ${requisitionId}.`);
  if (requisition.status !== "Approved") {
    throw new ValidationError(`Only an Approved requisition can be converted (current status: ${requisition.status}).`);
  }

  const order = await repo.createPurchaseOrder(companyId, {
    supplierId,
    requisitionId: requisition.id,
    orderDate,
    notes: requisition.notes,
    lines: requisition.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.estimatedUnitPrice })),
  });

  await requisitionRepo.setRequisitionStatus(companyId, requisitionId, "Converted");
  return order;
}

async function transitionOrder(companyId: string, orderId: number, to: PurchaseOrderStatus): Promise<PurchaseOrder> {
  const order = await repo.getPurchaseOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No purchase order with id ${orderId}.`);
  if (!canTransitionOrderStatus(order.status, to)) {
    throw new ValidationError(`Cannot move order ${order.orderNumber} from ${order.status} to ${to}.`);
  }
  return repo.setOrderStatus(companyId, orderId, to);
}

export const submitOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Submitted");
export const approveOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Approved");
export const rejectOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Rejected");
export const cancelOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Cancelled");

/** Pure — unit tested. Derives an order's real fulfillment status from
 * its lines' `receivedQuantity` vs `quantity`, mirroring
 * `sales-order-service.ts::computeOrderDeliveryStatus`. */
export function computeOrderReceiptStatus(lines: { quantity: number; receivedQuantity: number }[]): "PartiallyReceived" | "Received" {
  const fullyReceived = lines.every((l) => l.receivedQuantity >= l.quantity);
  return fullyReceived ? "Received" : "PartiallyReceived";
}

export async function refreshOrderReceiptStatus(companyId: string, orderId: number): Promise<PurchaseOrder> {
  const order = await repo.getPurchaseOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No purchase order with id ${orderId}.`);
  if (order.status !== "Approved" && order.status !== "PartiallyReceived") return order;
  const nextStatus = computeOrderReceiptStatus(order.lines);
  if (nextStatus === order.status) return order;
  return repo.setOrderStatus(companyId, orderId, nextStatus);
}
