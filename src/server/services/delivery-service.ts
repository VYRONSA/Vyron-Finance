/**
 * Service layer for Deliveries. No accounting impact. After creating a
 * Delivery against a Sales Order, refreshes that order's status
 * (Confirmed -> PartiallyDelivered/Delivered) from its lines' real
 * delivered-vs-ordered quantities — the concrete mechanism behind
 * "Partial Deliveries" and "Backorders".
 */

import * as repo from "@/server/repositories/delivery-repository";
import { incrementOrderLineQuantity } from "@/server/repositories/sales-order-repository";
import { refreshOrderDeliveryStatus } from "@/server/services/sales-order-service";
import type { Delivery } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export function validateDeliveryLines(lines: { description: string; quantity: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A delivery needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
  }
}

export const listDeliveries = repo.listDeliveries;
export const getDelivery = repo.getDelivery;

/** Creating a delivery IS the delivery event — it's recorded as
 * `Delivered` immediately (no separate Draft/confirm step, unlike
 * Invoices/Receipts which need an approval gate before they can affect
 * the books; a delivery has no accounting impact to approve). */
export async function createDelivery(companyId: string, input: repo.NewDelivery): Promise<Delivery> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.deliveryDate) throw new ValidationError("Delivery date is required.");
  validateDeliveryLines(input.lines);

  const created = await repo.createDelivery(companyId, input);
  const delivery = await repo.setDeliveryStatus(companyId, created.id, "Delivered");
  if (input.orderId) await refreshOrderDeliveryStatus(companyId, input.orderId);
  return delivery;
}

/** Workflow Completion Audit fix: cancelling a delivery used to only
 * flip the delivery's own status — it never reversed the
 * `delivered_quantity` it had added to the parent order's lines, nor
 * refreshed the order's delivery status. That permanently overstated the
 * order as (Partially)Delivered even though the delivery was voided,
 * silently blocking correct re-delivery/backorder tracking. Mirrors the
 * order-line reversal `incrementOrderLineQuantity` already supports
 * (called here with a negative amount) — no new mechanism, the exact
 * inverse of `createDelivery`'s own increment. */
export async function cancelDelivery(companyId: string, deliveryId: number): Promise<Delivery> {
  const delivery = await repo.getDelivery(companyId, deliveryId);
  if (!delivery) throw new NotFoundError(`No delivery with id ${deliveryId}.`);
  if (delivery.status === "Cancelled") {
    throw new ValidationError(`${delivery.deliveryNumber} is already cancelled.`);
  }

  for (const line of delivery.lines) {
    if (line.orderLineId) await incrementOrderLineQuantity(line.orderLineId, "delivered_quantity", -line.quantity);
  }

  const cancelled = await repo.setDeliveryStatus(companyId, deliveryId, "Cancelled");
  if (delivery.orderId) await refreshOrderDeliveryStatus(companyId, delivery.orderId);
  return cancelled;
}
