/**
 * Service layer for Sales Orders. No accounting impact — validation,
 * status workflow, and the real Quotation -> Order conversion (copies
 * lines, links back via `quotationId`, marks the source quote Converted).
 */

import * as repo from "@/server/repositories/sales-order-repository";
import * as quotationRepo from "@/server/repositories/quotation-repository";
import { listDeliveries } from "@/server/repositories/delivery-repository";
import { getCustomer } from "@/server/services/customer-service";
import { getCustomerFinancialSummary } from "@/server/services/customer-financial-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { computeLineAmounts } from "@/server/purchasing/line-amounts";
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

/** Finding #113 — mirrors `purchase-order-service.ts::computeOrderLine`/
 * `computeOrderLines` exactly. Pure — unit tested. */
export function computeOrderLine<T extends { quantity: number; unitPrice: number; discount?: number }>(line: T, vatRatePercent: number): T & { discount: number; netAmount: number; vatAmount: number } {
  const discount = line.discount ?? 0;
  const { netAmount, vatAmount } = computeLineAmounts(line.quantity, line.unitPrice, discount, vatRatePercent);
  return { ...line, discount, netAmount, vatAmount };
}

async function computeOrderLines(companyId: string, lines: repo.NewSalesOrderLine[]) {
  const vatTreatments = await listVatTreatments(companyId);
  return lines.map((line) => {
    if (line.vatCode && !vatTreatments.some((t) => t.code === line.vatCode)) {
      throw new ValidationError(`Unknown VAT treatment "${line.vatCode}".`);
    }
    const rate = line.vatCode ? (vatTreatments.find((t) => t.code === line.vatCode)?.rate ?? 0) : 0;
    return computeOrderLine(line, rate);
  });
}

/** Finding #036 — Credit Limit was captured and displayed
 * (`CustomerFinancialSummary.availableCredit` already computed it) but
 * never actually checked before a new sale. `creditLimit === 0` is
 * treated as "no limit configured" (bypasses the check) rather than
 * "zero credit allowed" — matching the same convention
 * `creditUtilisationPercent`'s own calculation already uses
 * (`customer.creditLimit > 0 ? ... : 0`), and avoiding silently
 * blocking every customer that was never given an explicit limit. */
async function assertWithinCreditLimit(companyId: string, customerId: number, orderTotal: number): Promise<void> {
  const customer = await getCustomer(companyId, customerId);
  if (!customer || customer.creditLimit <= 0) return;
  const { availableCredit } = await getCustomerFinancialSummary(companyId, customer);
  if (orderTotal > availableCredit) {
    throw new ValidationError(
      `This order (${orderTotal.toFixed(2)}) would exceed ${customer.name}'s available credit (${availableCredit.toFixed(2)} of a ${customer.creditLimit.toFixed(2)} limit).`,
    );
  }
}

export async function createSalesOrder(companyId: string, input: repo.NewSalesOrder): Promise<SalesOrder> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.orderDate) throw new ValidationError("Order date is required.");
  validateOrderLines(input.lines);
  const computedLines = await computeOrderLines(companyId, input.lines);
  const orderTotal = computedLines.reduce((sum, l) => sum + l.netAmount + l.vatAmount, 0);
  await assertWithinCreditLimit(companyId, input.customerId, orderTotal);
  return repo.createSalesOrder(companyId, { ...input, lines: computedLines });
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

/** Finding #164 — mirrors `purchase-order-service.ts::updateOrderLines`
 * exactly. Only a Draft order can be edited: once Confirmed, a Delivery
 * may already reference the order's lines by id
 * (`deliveries.order_line_id`, `delivered_quantity`) — replacing the
 * line set past that point would orphan or silently reset real
 * fulfilment history. */
export async function updateOrderLines(companyId: string, orderId: number, lines: repo.NewSalesOrderLine[]): Promise<SalesOrder> {
  const order = await repo.getSalesOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No sales order with id ${orderId}.`);
  if (order.status !== "Draft") {
    throw new ValidationError(`Only a Draft order can be edited (current status: ${order.status}).`);
  }
  validateOrderLines(lines);
  const computedLines = await computeOrderLines(companyId, lines);
  return repo.replaceOrderLines(companyId, orderId, computedLines);
}

export const confirmOrder = (companyId: string, orderId: number) => transitionOrder(companyId, orderId, "Confirmed");

/** Finding #188/#189 — cancelling an order that already has a real,
 * non-cancelled Delivery against it used to succeed silently, leaving
 * the Delivery standing while the order it fulfils is now Cancelled.
 * Blocked here rather than auto-reversed: unlike a straight status flip,
 * un-doing a Delivery also means reversing whatever it fed into (an
 * Invoice may already exist against it) — that's the operator's call,
 * not something to cascade automatically. */
export async function cancelOrder(companyId: string, orderId: number): Promise<SalesOrder> {
  const deliveries = await listDeliveries(companyId);
  const activeDelivery = deliveries.find((d) => d.orderId === orderId && d.status !== "Cancelled");
  if (activeDelivery) {
    throw new ValidationError(`Cannot cancel this order — ${activeDelivery.deliveryNumber} has already been delivered against it. Cancel the delivery first.`);
  }
  return transitionOrder(companyId, orderId, "Cancelled");
}

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
