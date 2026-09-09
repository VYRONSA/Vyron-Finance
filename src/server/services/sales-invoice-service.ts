/**
 * Service layer for Sales Invoices (Invoice/Credit Note/Debit Note). The
 * real integration point the whole Sales Platform exists for: approving
 * one of these documents resolves the matching Posting Rule (seeded in
 * 0007_general_ledger.sql) into a real journal, which then flows through
 * the one Posting Engine (`posting-engine-service.ts::postApprovedJournals`)
 * — exactly the same code path every other journal in the system uses.
 * Nothing here writes to `ae_journals`/`gl_transactions` directly; this
 * file only ever calls the existing GL services, never re-implements
 * posting.
 *
 * Business Event -> Posting Rule -> Journal -> General Ledger, per the
 * Product Review Board's own diagram — Debit Notes reuse the "Sales
 * Invoice" rule (identical DR Debtors / CR Sales / CR VAT Output shape;
 * no separate "Customer Debit Note" rule exists or is needed).
 *
 * "Sales should automatically reduce inventory. Invoices should update
 * stock. Credit Notes should restore stock" — any invoice line carrying
 * a real `stockItemId` triggers a second, real inventory movement
 * (Inventory Issue for Invoice/Debit Note, Inventory Return for Credit
 * Note) in the same call, via
 * `inventory-transaction-service.ts::createAndAutoPost`. This is a
 * genuinely separate DR COGS/CR Inventory journal alongside the sales
 * journal above — both are correct, not double-counting (revenue
 * recognition and cost of goods sold are two different facts).
 */

import * as repo from "@/server/repositories/sales-invoice-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as orderRepo from "@/server/repositories/sales-order-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import { listInventoryTransactions } from "@/server/repositories/inventory-transaction-repository";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { createAndAutoPost } from "@/server/services/inventory-transaction-service";
import type { SalesInvoice, SalesInvoiceDocumentType, SalesInvoiceStatus } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const EVENT_TYPE_BY_DOCUMENT: Record<SalesInvoiceDocumentType, string> = {
  Invoice: "Sales Invoice",
  "Debit Note": "Sales Invoice",
  "Credit Note": "Customer Credit Note",
};

export function validateInvoiceLines(lines: { description: string; quantity: number; unitPrice: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A sales invoice needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    if (line.unitPrice < 0) throw new ValidationError("Unit price cannot be negative.");
  }
}

export const listSalesInvoices = repo.listSalesInvoices;
export const listSalesInvoicesByCustomer = repo.listSalesInvoicesByCustomer;
export const getSalesInvoice = repo.getSalesInvoice;

export async function createSalesInvoice(companyId: string, input: repo.NewSalesInvoice): Promise<SalesInvoice> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.invoiceDate) throw new ValidationError("Invoice date is required.");
  if (!input.vatTreatmentCode) throw new ValidationError("VAT Treatment is required.");
  validateInvoiceLines(input.lines);

  const vatTreatments = await listVatTreatments(companyId);
  const treatment = vatTreatments.find((t) => t.code === input.vatTreatmentCode);
  if (!treatment) throw new ValidationError(`Unknown VAT treatment "${input.vatTreatmentCode}".`);

  return repo.createSalesInvoice(companyId, input, treatment.rate);
}

/** Finding #053 — Order -> Invoice conversion used to require the order
 * be fully `Delivered`; a `PartiallyDelivered` order (real, common —
 * backorders exist for exactly this reason) had no way to invoice the
 * portion already delivered without waiting for the rest. Pure — unit
 * tested — computes, per line, the still-undelivered-and-uninvoiced
 * remainder (`deliveredQuantity - invoicedQuantity`, never negative). */
export function computeInvoiceableLines<T extends { quantity: number; deliveredQuantity: number; invoicedQuantity: number }>(lines: T[]): (T & { invoiceQuantity: number })[] {
  return lines
    .map((l) => ({ ...l, invoiceQuantity: Math.max(0, l.deliveredQuantity - l.invoicedQuantity) }))
    .filter((l) => l.invoiceQuantity > 0);
}

/** Real Order -> Invoice conversion — "Orders can be converted into
 * invoices" per the completion standard. Invoices only the delivered-but-
 * not-yet-invoiced remainder of each line (see `computeInvoiceableLines`)
 * — a `PartiallyDelivered` order can now be invoiced for what's actually
 * been delivered so far, same as `Delivered`. The order only reaches the
 * terminal `Invoiced` status once every line's ordered quantity has been
 * fully invoiced; otherwise it stays at its current status so the
 * remaining delivery/invoice cycle can continue. */
export async function createInvoiceFromOrder(
  companyId: string,
  orderId: number,
  invoiceDate: string,
  vatTreatmentCode: string,
): Promise<SalesInvoice> {
  const order = await orderRepo.getSalesOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No sales order with id ${orderId}.`);
  if (order.status !== "Delivered" && order.status !== "PartiallyDelivered") {
    throw new ValidationError(`Only a Delivered or PartiallyDelivered order can be invoiced (current status: ${order.status}).`);
  }

  const invoiceableLines = computeInvoiceableLines(order.lines);
  if (invoiceableLines.length === 0) {
    throw new ValidationError(`${order.orderNumber} has nothing delivered that hasn't already been invoiced.`);
  }

  const invoice = await createSalesInvoice(companyId, {
    customerId: order.customerId,
    orderId: order.id,
    invoiceDate,
    vatTreatmentCode,
    reference: order.orderNumber,
    lines: invoiceableLines.map((l) => ({ description: l.description, quantity: l.invoiceQuantity, unitPrice: l.unitPrice, stockItemId: l.stockItemId })),
  });

  for (const line of invoiceableLines) {
    await orderRepo.incrementOrderLineQuantity(companyId, line.id, "invoiced_quantity", line.invoiceQuantity);
  }

  const fullyInvoiced = order.lines.every((l) => {
    const invoiced = invoiceableLines.find((il) => il.id === l.id)?.invoiceQuantity ?? 0;
    return l.invoicedQuantity + invoiced >= l.quantity;
  });
  if (fullyInvoiced) await orderRepo.setOrderStatus(companyId, orderId, "Invoiced");

  return invoice;
}

const ALLOWED_TRANSITIONS: Record<SalesInvoiceStatus, SalesInvoiceStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Cancelled"],
  Approved: [],
  Posted: [],
  Cancelled: [],
};

export function canTransitionInvoiceStatus(from: SalesInvoiceStatus, to: SalesInvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

async function requireInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const invoice = await repo.getSalesInvoice(companyId, invoiceId);
  if (!invoice) throw new NotFoundError(`No sales invoice with id ${invoiceId}.`);
  return invoice;
}

export async function submitInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const invoice = await requireInvoice(companyId, invoiceId);
  if (!canTransitionInvoiceStatus(invoice.status, "Submitted")) {
    throw new ValidationError(`Cannot submit ${invoice.invoiceNumber} from status ${invoice.status}.`);
  }
  return repo.submitInvoice(companyId, invoiceId);
}

export async function cancelInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const invoice = await requireInvoice(companyId, invoiceId);
  if (!canTransitionInvoiceStatus(invoice.status, "Cancelled")) {
    throw new ValidationError(`Cannot cancel ${invoice.invoiceNumber} from status ${invoice.status}.`);
  }
  return repo.cancelInvoice(companyId, invoiceId);
}

/** Approve AND post in one call — "journals are generated automatically"
 * and "customer balances update automatically" per the PRB, achieved by
 * synchronously invoking the same shared Posting Engine right after
 * creating the Approved journal, rather than requiring a separate manual
 * "Post Approved Journals" click. If the Posting Engine itself skips the
 * journal (e.g. a closed Financial Period), the invoice honestly stays
 * Approved-but-not-Posted — the same real, visible intermediate state a
 * manually-created GL journal can be in — rather than lying about it. */
export async function approveAndPostInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const invoice = await requireInvoice(companyId, invoiceId);
  if (!canTransitionInvoiceStatus(invoice.status, "Approved")) {
    throw new ValidationError(`Cannot approve ${invoice.invoiceNumber} from status ${invoice.status}.`);
  }

  const vatTreatments = await listVatTreatments(companyId);
  const treatment = vatTreatments.find((t) => t.code === invoice.vatTreatmentCode);
  const vatRatePercent = treatment?.rate ?? 0;
  const eventType = EVENT_TYPE_BY_DOCUMENT[invoice.documentType];

  const built = await buildJournalFromEvent(companyId, eventType, {
    grossAmount: invoice.total,
    vatRatePercent,
    description: `${invoice.documentType} ${invoice.invoiceNumber}`,
  });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${invoice.invoiceNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: invoice.documentType,
    description: `${invoice.documentType} ${invoice.invoiceNumber}${invoice.reference ? ` — ${invoice.reference}` : ""}`,
    reference: invoice.reference || invoice.invoiceNumber,
    sourceType: "sales_invoice",
    sourceId: invoice.id,
    status: "Approved",
    lines: built.lines,
  });

  await repo.approveInvoice(companyId, invoiceId, journal.id);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(
      `${invoice.invoiceNumber} was approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`,
    );
  }

  await applyInventoryMovement(companyId, invoice);

  return repo.markInvoicePosted(companyId, invoiceId);
}

/** The real "Sales reduces inventory" / "Credit Notes restore stock"
 * hook. Runs after the sales journal is confirmed posted (never before —
 * a failed sales post should never leave stock quietly moved with
 * nothing on the books to show for it).
 *
 * Finding #115 — this can now be re-entered by `retryPostInvoice` after a
 * partial failure (e.g. line 2 of 3 lacks a default warehouse), so each
 * line first checks whether a non-cancelled movement already exists for
 * this exact invoice+stock item before creating another — otherwise a
 * retry would double-issue whichever lines had already succeeded.
 *
 * Finding #054 — an Invoice/Debit Note created from an order
 * (`orderId !== null`, via `createInvoiceFromOrder`) only ever invoices
 * quantity that's already been delivered (`computeInvoiceableLines`
 * guarantees `deliveredQuantity >= invoiced quantity`) — `delivery-service.ts`
 * already moved that stock the moment it was physically delivered, so
 * moving it again here would double-decrement. Only a standalone
 * document with no order (no Delivery ever existed for it) still moves
 * stock at this point. A Credit Note always restores stock here
 * regardless of order linkage — it's reversing this specific invoice's
 * revenue, not re-litigating whether a delivery happened. */
async function applyInventoryMovement(companyId: string, invoice: SalesInvoice): Promise<void> {
  if (invoice.orderId !== null && invoice.documentType !== "Credit Note") return;

  const stockLines = invoice.lines.filter((line) => line.stockItemId !== null);
  if (stockLines.length === 0) return;

  const transactionType = invoice.documentType === "Credit Note" ? "Return" : "Issue";
  const existing = await listInventoryTransactions(companyId, transactionType);
  const alreadyMoved = new Set(
    existing.filter((t) => t.sourceType === "sales_invoice" && t.sourceId === invoice.id && t.status !== "Cancelled").flatMap((t) => t.lines.map((l) => l.stockItemId)),
  );

  for (const line of stockLines) {
    if (alreadyMoved.has(line.stockItemId!)) continue;
    const item = await itemRepo.getStockItem(companyId, line.stockItemId!);
    if (!item) throw new ValidationError(`No stock item with id ${line.stockItemId}.`);
    if (!item.defaultWarehouseId) {
      throw new ValidationError(`${item.stockCode} has no default warehouse set — required to move stock automatically.`);
    }
    await createAndAutoPost(companyId, transactionType, {
      transactionDate: invoice.invoiceDate,
      warehouseId: item.defaultWarehouseId,
      reference: invoice.invoiceNumber,
      notes: `${invoice.documentType} ${invoice.invoiceNumber}: ${item.stockCode}`,
      sourceType: "sales_invoice",
      sourceId: invoice.id,
      lines: [{ stockItemId: item.id, quantity: line.quantity, unitCost: item.averageCost }],
    });
  }
}

/** Recovery path for the two real gaps `approveAndPostInvoice` can leave
 * behind. Finding #115 — `applyInventoryMovement` runs after the journal
 * is confirmed posted but before `markInvoicePosted`; if it throws (e.g.
 * a stock item has no default warehouse), the invoice is left `Approved`
 * with its journal *already Posted*. The original version of this
 * function only ever re-ran `postApprovedJournals`, which only evaluates
 * journals still in `Approved` status — a journal that's already Posted
 * would never appear in its `posted` list, so a retry after this specific
 * failure always (incorrectly) reported "still could not be posted,"
 * with no real way back short of a manual DB edit. Now checks the
 * journal's actual current status first: if it's already Posted, skip
 * straight to retrying the inventory movement instead of re-posting. */
export async function retryPostInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const invoice = await requireInvoice(companyId, invoiceId);
  if (invoice.status !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted invoice can retry posting (current status: ${invoice.status}).`);
  }
  if (invoice.journalId === null) {
    throw new ValidationError(`${invoice.invoiceNumber} has no linked journal to post.`);
  }

  const journal = await journalRepo.getJournal(companyId, invoice.journalId);
  if (journal?.status !== "Posted") {
    const outcome = await postApprovedJournals(companyId);
    const wasPosted = outcome.posted.some((p) => p.journalId === invoice.journalId);
    if (!wasPosted) {
      const skip = outcome.skipped.find((s) => s.journalId === invoice.journalId);
      throw new ValidationError(`${invoice.invoiceNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
    }
  }

  await applyInventoryMovement(companyId, invoice);
  return repo.markInvoicePosted(companyId, invoiceId);
}
