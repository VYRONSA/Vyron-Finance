/**
 * Service layer for Deliveries. After creating a Delivery against a
 * Sales Order, refreshes that order's status (Confirmed ->
 * PartiallyDelivered/Delivered) from its lines' real
 * delivered-vs-ordered quantities — the concrete mechanism behind
 * "Partial Deliveries" and "Backorders".
 *
 * Finding #054 — "Sales should reduce inventory at Delivery, not only at
 * Invoice." Any delivery line carrying a real `stockItemId` now triggers
 * a real Inventory Issue (mirrors `goods-received-note-service.ts`'s own
 * automatic Receipt exactly). `sales-invoice-service.ts::approveAndPostInvoice`
 * skips its own inventory movement for any invoice created from an order
 * (`orderId !== null`) — that stock was already moved here, at the
 * moment it was actually delivered; only a standalone invoice with no
 * order (and therefore no Delivery) still moves stock at invoice time.
 */

import * as repo from "@/server/repositories/delivery-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import { incrementOrderLineQuantity } from "@/server/repositories/sales-order-repository";
import { listSalesInvoices } from "@/server/repositories/sales-invoice-repository";
import { refreshOrderDeliveryStatus } from "@/server/services/sales-order-service";
import { createAndAutoPost } from "@/server/services/inventory-transaction-service";
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

  const stockLines = delivery.lines.filter((line) => line.stockItemId !== null);
  for (const line of stockLines) {
    const item = await itemRepo.getStockItem(companyId, line.stockItemId!);
    if (!item) throw new ValidationError(`No stock item with id ${line.stockItemId}.`);
    if (!item.defaultWarehouseId) {
      throw new ValidationError(`${item.stockCode} has no default warehouse set — required to move stock automatically.`);
    }
    await createAndAutoPost(companyId, "Issue", {
      transactionDate: delivery.deliveryDate,
      warehouseId: item.defaultWarehouseId,
      reference: delivery.deliveryNumber,
      notes: `Delivered: ${item.stockCode}`,
      sourceType: "delivery",
      sourceId: delivery.id,
      lines: [{ stockItemId: item.id, quantity: line.quantity, unitCost: item.averageCost }],
    });
  }

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

  /** Finding #188 — a Delivery that already has a real, non-cancelled
   * Invoice against it (real revenue/inventory-issue booked) can't be
   * silently cancelled out from under that invoice. */
  const invoices = await listSalesInvoices(companyId);
  const activeInvoice = invoices.find((i) => i.deliveryId === deliveryId && i.status !== "Cancelled");
  if (activeInvoice) {
    throw new ValidationError(`Cannot cancel ${delivery.deliveryNumber} — ${activeInvoice.invoiceNumber} has already been invoiced against it.`);
  }

  /** Finding #054 companion — reverses the automatic Issue `createDelivery`
   * now triggers, via a real "Return" transaction (the exact mechanism
   * `sales-invoice-service.ts::applyInventoryMovement` already uses to
   * restore stock for a Credit Note) rather than a new reversal
   * mechanism — same reasoning as GRN cancellation reversing its Receipt. */
  const stockLines = delivery.lines.filter((line) => line.stockItemId !== null);
  for (const line of stockLines) {
    const item = await itemRepo.getStockItem(companyId, line.stockItemId!);
    if (!item) throw new ValidationError(`No stock item with id ${line.stockItemId}.`);
    if (!item.defaultWarehouseId) throw new ValidationError(`${item.stockCode} has no default warehouse set.`);
    await createAndAutoPost(companyId, "Return", {
      transactionDate: delivery.deliveryDate,
      warehouseId: item.defaultWarehouseId,
      reference: delivery.deliveryNumber,
      notes: `Delivery cancelled: ${item.stockCode}`,
      sourceType: "delivery_reversal",
      sourceId: delivery.id,
      lines: [{ stockItemId: item.id, quantity: line.quantity, unitCost: item.averageCost }],
    });
  }

  for (const line of delivery.lines) {
    if (line.orderLineId) await incrementOrderLineQuantity(companyId, line.orderLineId, "delivered_quantity", -line.quantity);
  }

  const cancelled = await repo.setDeliveryStatus(companyId, deliveryId, "Cancelled");
  if (delivery.orderId) await refreshOrderDeliveryStatus(companyId, delivery.orderId);
  return cancelled;
}
