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

/** Real Order -> Invoice conversion — "Orders can be converted into
 * invoices" per the completion standard. Copies the order's own lines
 * (an order that's been through partial deliveries is only convertible
 * once fully `Delivered`, matching `sales-order-service.ts`'s own
 * `Delivered -> Invoiced` transition), marks every line fully invoiced,
 * and moves the order to `Invoiced` so it can't be converted twice. */
export async function createInvoiceFromOrder(
  companyId: string,
  orderId: number,
  invoiceDate: string,
  vatTreatmentCode: string,
): Promise<SalesInvoice> {
  const order = await orderRepo.getSalesOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No sales order with id ${orderId}.`);
  if (order.status !== "Delivered") {
    throw new ValidationError(`Only a Delivered order can be invoiced (current status: ${order.status}).`);
  }

  const invoice = await createSalesInvoice(companyId, {
    customerId: order.customerId,
    orderId: order.id,
    invoiceDate,
    vatTreatmentCode,
    reference: order.orderNumber,
    lines: order.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, stockItemId: l.stockItemId })),
  });

  for (const line of order.lines) {
    await orderRepo.incrementOrderLineQuantity(line.id, "invoiced_quantity", line.quantity);
  }
  await orderRepo.setOrderStatus(companyId, orderId, "Invoiced");

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
 * nothing on the books to show for it). */
async function applyInventoryMovement(companyId: string, invoice: SalesInvoice): Promise<void> {
  const stockLines = invoice.lines.filter((line) => line.stockItemId !== null);
  if (stockLines.length === 0) return;

  const transactionType = invoice.documentType === "Credit Note" ? "Return" : "Issue";
  for (const line of stockLines) {
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

/** Recovery path for the one real gap `approveAndPostInvoice` can leave
 * behind: if the Posting Engine skipped the journal (e.g. the Financial
 * Period was closed at approval time), the invoice is genuinely stuck at
 * `Approved` with a real journal that's never been posted — retries the
 * same posting run and, if it succeeds this time, marks the invoice
 * Posted. Without this there would be no way back from that state short
 * of a manual DB edit. */
export async function retryPostInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const invoice = await requireInvoice(companyId, invoiceId);
  if (invoice.status !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted invoice can retry posting (current status: ${invoice.status}).`);
  }
  if (invoice.journalId === null) {
    throw new ValidationError(`${invoice.invoiceNumber} has no linked journal to post.`);
  }

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === invoice.journalId);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === invoice.journalId);
    throw new ValidationError(`${invoice.invoiceNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  return repo.markInvoicePosted(companyId, invoiceId);
}
