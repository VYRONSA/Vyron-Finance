/**
 * Service layer for Sales Orders. No accounting impact — validation,
 * status workflow, and the real Quotation -> Order conversion (copies
 * lines, links back via `quotationId`, marks the source quote Converted).
 */

import * as repo from "@/server/repositories/sales-order-repository";
import * as quotationRepo from "@/server/repositories/quotation-repository";
import type { SalesOrder, SalesOrderStatus } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const ALLOWED_TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  Draft: ["Confirmed", "Cancelled"],
  Confirmed: ["PartiallyDelivered", "Delivered", "Cancelled"],
  PartiallyDelivered: ["Delivered", "Cancelled"],
  Delivered: ["Invoiced"],
  Invoiced: [],
  Cancelled: [],
};

export function canTransitionOrderStatus(from: SalesOrderStatus, to: SalesOrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateOrderLines(lines: { description: string; quantity: number; unitPrice: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A sales order needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    if (line.unitPrice < 0) throw new ValidationError("Unit price cannot be negative.");
  }
}

export const listSalesOrders = repo.listSalesOrders;
export const getSalesOrder = repo.getSalesOrder;

export async function createSalesOrder(companyId: string, input: repo.NewSalesOrder): Promise<SalesOrder> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.orderDate) throw new ValidationError("Order date is required.");
  validateOrderLines(input.lines);
  return repo.createSalesOrder(companyId, input);
}

/** Real conversion — copies the quotation's own lines rather than asking
 * the caller to re-key them, and marks the source quotation Converted so
 * it can't be converted twice. */
export async function createOrderFromQuotation(companyId: string, quotationId: number, orderDate: string): Promise<SalesOrder> {
  const quotation = await quotationRepo.getQuotation(companyId, quotationId);
  if (!quotation) throw new NotFoundError(`No quotation with id ${quotationId}.`);
  if (quotation.status !== "Accepted") {
    throw new ValidationError(`Only an Accepted quotation can be converted (current status: ${quotation.status}).`);
  }

  const order = await repo.createSalesOrder(companyId, {
    customerId: quotation.customerId,
    quotationId: quotation.id,
    orderDate,
    notes: quotation.notes,
    lines: quotation.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
  });

  await quotationRepo.setQuotationStatus(companyId, quotationId, "Converted");
  return order;
}

async function transitionOrder(companyId: string, orderId: number, to: SalesOrderStatus): Promise<SalesOrder> {
  const order = await repo.getSalesOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No sales order with id ${orderId}.`);
  if (!canTransitionOrderStatus(order.status, to)) {
    throw new ValidationError(`Cannot move order ${order.orderNumber} from ${order.status} to ${to}.`);
  }
  return repo.setOrderStatus(companyId, orderId, to);
}

export const confirmOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Confirmed");
export const cancelOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Cancelled");

/** Pure — unit tested. Derives an order's real fulfillment status from
 * its lines' `deliveredQuantity` vs `quantity` — used after a Delivery is
 * created against this order to decide whether it's now fully or only
 * Partially delivered (a Backorder is just `quantity - deliveredQuantity`
 * on any line where that's > 0, not a separate stored concept). */
export function computeOrderDeliveryStatus(lines: { quantity: number; deliveredQuantity: number }[]): "PartiallyDelivered" | "Delivered" {
  const fullyDelivered = lines.every((l) => l.deliveredQuantity >= l.quantity);
  return fullyDelivered ? "Delivered" : "PartiallyDelivered";
}

export async function refreshOrderDeliveryStatus(companyId: string, orderId: number): Promise<SalesOrder> {
  const order = await repo.getSalesOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No sales order with id ${orderId}.`);
  if (order.status !== "Confirmed" && order.status !== "PartiallyDelivered") return order;
  const nextStatus = computeOrderDeliveryStatus(order.lines);
  if (nextStatus === order.status) return order;
  return repo.setOrderStatus(companyId, orderId, nextStatus);
}
