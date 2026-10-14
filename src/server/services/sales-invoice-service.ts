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
import { getCustomer } from "@/server/services/customer-service";
import { getCompany } from "@/server/services/company-service";
import { computeInvoiceTotalsFromCodes } from "@/server/sales/invoice-totals";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import type { SalesInvoice, SalesInvoiceDocumentType, SalesInvoiceStatus } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const EVENT_TYPE_BY_DOCUMENT: Record<SalesInvoiceDocumentType, string> = {
  Invoice: "Sales Invoice",
  "Debit Note": "Sales Invoice",
  "Credit Note": "Customer Credit Note",
};

export function validateInvoiceLines(lines: { description: string; quantity: number; unitPrice: number; discount?: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A sales invoice needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    if (line.unitPrice < 0) throw new ValidationError("Unit price cannot be negative.");
    // Phase 5J — a discount now reduces what is charged and what VAT is
    // owed on it, so it has to be bounded. A negative discount is a
    // surcharge entered in the wrong field; one larger than the line is
    // a negative line, which would understate output VAT.
    const discount = line.discount ?? 0;
    if (!Number.isFinite(discount) || discount < 0) throw new ValidationError("A discount cannot be negative.");
    if (discount > Math.round(line.quantity * line.unitPrice * 100) / 100) {
      throw new ValidationError("A discount cannot be more than the line it applies to.");
    }
  }
}

/** Phase 5J — which due date a new document gets, and where it came from.
 *
 * `customers.payment_terms_days` has existed since 0008 (`not null
 * default 30`), is captured on the customer form and shown on their
 * detail page — and was read by nothing in the invoicing path. Every
 * invoice was due whenever someone typed a date, and an invoice created
 * from an order got no due date at all. A null due date is not neutral:
 * `shared/aging.ts` puts the whole balance in `Current`, so such an
 * invoice is never overdue in any ageing report, statement or dashboard.
 *
 * The hierarchy, most specific first:
 *   1. an explicit date on the request — someone chose it, so it stands,
 *      and `paymentTermsDays` is recorded as null because no terms
 *      produced it;
 *   2. the customer's own payment terms;
 *   3. the company default (`companies.default_payment_terms_days`, 0106).
 *
 * Pure and exported so the derivation is testable without a database,
 * and so the form can show the same date it is going to get.
 */
export function resolveDueDate(input: {
  explicitDueDate?: string | null;
  invoiceDate: string;
  customerPaymentTermsDays?: number | null;
  companyDefaultPaymentTermsDays?: number | null;
}): { dueDate: string | null; paymentTermsDays: number | null } {
  const explicit = input.explicitDueDate?.trim();
  if (explicit) return { dueDate: explicit, paymentTermsDays: null };

  const terms = input.customerPaymentTermsDays ?? input.companyDefaultPaymentTermsDays ?? null;
  if (terms === null || !Number.isFinite(terms) || terms < 0) return { dueDate: null, paymentTermsDays: null };

  // Date-only arithmetic in UTC: `invoiceDate` is a DATE column with no
  // timezone, and adding days through a local-time Date would shift the
  // result across a DST boundary.
  const base = Date.parse(`${input.invoiceDate}T00:00:00Z`);
  if (Number.isNaN(base)) return { dueDate: null, paymentTermsDays: null };
  const due = new Date(base + terms * 86_400_000).toISOString().slice(0, 10);
  return { dueDate: due, paymentTermsDays: terms };
}

/** Phase 5J — the particulars VAT Act s21(3) requires on a credit or
 * debit note, checked where the message can name the missing field.
 *
 * Deliberately NOT a database constraint: credit notes issued before this
 * phase genuinely carry neither, and a CHECK would retroactively
 * invalidate documents already given to customers and to SARS. The rule
 * binds new documents; the historical ones stay exactly as they were
 * issued, and the printed document says plainly when a reason is not on
 * record rather than implying one.
 *
 * An Invoice may carry neither — there is no earlier document for it to
 * reference, and nothing to explain. */
export function validateAdjustmentNoteParticulars(input: {
  documentType: SalesInvoiceDocumentType;
  originalInvoiceId?: number | null;
  reason?: string;
}): void {
  if (input.documentType === "Invoice") return;
  const noun = input.documentType === "Credit Note" ? "credit note" : "debit note";
  if (!input.originalInvoiceId) {
    throw new ValidationError(`A ${noun} must name the invoice it adjusts.`);
  }
  if (!input.reason?.trim()) {
    throw new ValidationError(`A ${noun} must state the reason it was issued.`);
  }
}

export const listSalesInvoices = repo.listSalesInvoices;
export const listSalesInvoicesByCustomer = repo.listSalesInvoicesByCustomer;
export const getSalesInvoice = repo.getSalesInvoice;

/**
 * Phase 5J — this is where a Sales document's figures are decided, once.
 *
 * Three things changed, and all three are accounting behaviour:
 *
 *  - Per-line VAT codes and discounts now determine the subtotal, VAT and
 *    total (`sales/invoice-totals.ts`). They were captured and stored but
 *    ignored, so a line marked Zero Rated was still charged VAT at the
 *    header rate and a discount reduced nothing.
 *  - The due date is derived from payment terms when none is given
 *    (`resolveDueDate`), instead of being left null and therefore never
 *    overdue.
 *  - A credit or debit note must name the invoice it adjusts and say why
 *    (`validateAdjustmentNoteParticulars`).
 *
 * The client never decides any of this. The form previews the identical
 * arithmetic from the identical module, but the figures stored are the
 * ones computed here, from the company's own `vat_treatments`.
 */
export async function createSalesInvoice(companyId: string, input: repo.NewSalesInvoice): Promise<SalesInvoice> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.invoiceDate) throw new ValidationError("Invoice date is required.");
  if (!input.vatTreatmentCode) throw new ValidationError("VAT Treatment is required.");
  validateInvoiceLines(input.lines);

  /* Phase 5J — a caller may not choose a tax invoice's serial number.
   *
   * `NewSalesInvoice.invoiceNumber` is optional, and the POST route hands
   * the request body to this function verbatim — so any Sales:Create user
   * could name their own invoice number, which defeats the whole point of
   * the 0105 counter: duplicate serials across documents, or a number
   * jumped ahead of the counter that a later real invoice then collides
   * with. VAT Act s20(4)(b) makes that number a legal identifier.
   *
   * The number is allocated by the database, always, for anything coming
   * through this service. The Xero import legitimately preserves the
   * numbers Xero already issued, and calls the REPOSITORY directly for
   * exactly that reason — it is migrating a historical ledger, not
   * issuing new documents. */
  const { invoiceNumber: _rejected, ...rest } = input;
  if (_rejected !== undefined) {
    throw new ValidationError("An invoice number is allocated by the system and cannot be supplied.");
  }
  input = rest;

  const documentType = input.documentType ?? "Invoice";
  validateAdjustmentNoteParticulars({ documentType, originalInvoiceId: input.originalInvoiceId, reason: input.reason });

  // A credit note must adjust an invoice of THIS company's, belonging to
  // the same customer — otherwise it would reference a document that
  // cannot be reconciled to it, and RLS alone would not catch a same-
  // tenant mismatch.
  if (input.originalInvoiceId) {
    const original = await repo.getSalesInvoice(companyId, input.originalInvoiceId);
    if (!original) throw new NotFoundError(`No sales invoice with id ${input.originalInvoiceId}.`);
    if (original.customerId !== input.customerId) {
      throw new ValidationError(`${original.invoiceNumber} belongs to a different customer.`);
    }
    if (original.documentType !== "Invoice") {
      throw new ValidationError(`${original.invoiceNumber} is a ${original.documentType}, not an invoice.`);
    }
  }

  const vatTreatments = await listVatTreatments(companyId);
  const treatment = vatTreatments.find((t) => t.code === input.vatTreatmentCode);
  if (!treatment) throw new ValidationError(`Unknown VAT treatment "${input.vatTreatmentCode}".`);

  const ratesByCode = new Map(vatTreatments.map((t) => [t.code, t.rate]));
  const computed = computeInvoiceTotalsFromCodes(input.lines, treatment.rate, ratesByCode);
  if (!computed.ok) throw new ValidationError(`Unknown VAT treatment "${computed.unknownVatCode}" on a line.`);

  const [customer, company] = await Promise.all([getCustomer(companyId, input.customerId), getCompany(companyId)]);
  if (!customer) throw new NotFoundError(`No customer with id ${input.customerId}.`);
  const { dueDate, paymentTermsDays } = resolveDueDate({
    explicitDueDate: input.dueDate,
    invoiceDate: input.invoiceDate,
    customerPaymentTermsDays: customer.paymentTermsDays,
    companyDefaultPaymentTermsDays: company?.defaultPaymentTermsDays ?? null,
  });
  if (dueDate && dueDate < input.invoiceDate) {
    throw new ValidationError("The due date cannot be before the invoice date.");
  }

  return repo.createSalesInvoice(companyId, { ...input, dueDate, paymentTermsDays }, computed.totals);
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

/**
 * Assigns a revenue account to the lines of ONE Draft invoice that have
 * none — the supported repair for invoices imported without an account
 * (Batch 1B of the Handcrafted Food Products migration). Narrow on
 * purpose:
 *  - Draft only: a submitted, approved or posted invoice is never touched;
 *  - only lines whose account is empty; an assigned account is never
 *    changed, so this cannot re-code anything;
 *  - only an active Income account that exists in this company's chart;
 *  - only `gl_account` is written: quantities, prices, VAT and totals are
 *    left exactly as stored (and checked afterwards);
 *  - every change is recorded in the audit log against the invoice. If
 *    that record cannot be written the change is undone and an error
 *    returned, so no change is ever left unaudited.
 * The account on a sales line drives the Reporting Centre's sales-by-account
 * and VAT-by-account breakdowns; posting takes its accounts from the
 * posting rule, so this changes no journal.
 */
export async function assignMissingLineAccounts(companyId: string, invoiceId: number, glAccount: string, performedBy: string): Promise<SalesInvoice> {
  const invoice = await requireInvoice(companyId, invoiceId);
  if (invoice.status !== "Draft") {
    throw new ValidationError(`${invoice.invoiceNumber} is ${invoice.status}; accounts can only be assigned on a Draft.`);
  }
  const code = typeof glAccount === "string" ? glAccount.trim() : "";
  const account = (await listChartOfAccounts(companyId)).find((a) => a.accountCode === code);
  if (!account) throw new ValidationError(`Account "${code}" is not in the chart of accounts.`);
  if (!account.isActive) throw new ValidationError(`Account ${code} is inactive.`);
  if (account.accountType !== "Income") throw new ValidationError(`Account ${code} is ${account.accountType}; a sales line needs an Income account.`);

  const missing = invoice.lines.filter((l) => !l.glAccount).map((l) => l.id);
  if (missing.length === 0) throw new ValidationError(`Every line on ${invoice.invoiceNumber} already has an account.`);

  const changed = await repo.setMissingLineAccounts(invoiceId, missing, code);
  if (changed.length === 0) throw new ValidationError(`No line on ${invoice.invoiceNumber} was changed; it may have been updated by someone else.`);
  try {
    await recordAuditEntry(companyId, {
      performedBy,
      actionType: "SalesInvoiceLineAccountsAssigned",
      reason: `Assigned account ${code} (${account.description}) to ${changed.length} line(s) of Draft ${invoice.invoiceNumber} that had no account. Amounts, VAT and totals unchanged.`,
      changes: {
        invoiceNumber: invoice.invoiceNumber,
        glAccount: code,
        lineIds: changed,
        previousGlAccount: null,
        totals: { subtotal: invoice.subtotal, vatAmount: invoice.vatAmount, total: invoice.total },
      },
      documentType: "SalesInvoice",
      documentId: invoiceId,
      isReversible: true,
    });
  } catch (error) {
    await repo.clearLineAccounts(invoiceId, changed, code);
    throw error;
  }

  const after = await requireInvoice(companyId, invoiceId);
  if (after.subtotal !== invoice.subtotal || after.vatAmount !== invoice.vatAmount || after.total !== invoice.total) {
    // Cannot happen (only gl_account is written) — refuse loudly if it ever does.
    throw new Error(`Totals of ${invoice.invoiceNumber} changed while assigning accounts.`);
  }
  return after;
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

  const eventType = EVENT_TYPE_BY_DOCUMENT[invoice.documentType];

  /* Phase 5J — the journal is posted from the invoice's OWN saved
   * figures, not from a fresh split of its total.
   *
   * This used to look the VAT treatment up again at approval time and
   * hand `buildJournalFromEvent` a gross amount plus one rate, letting
   * `splitGrossAmount` re-derive the net/VAT. Three things were wrong
   * with that, and all three disappear by passing the stored split:
   *
   *  - One blended rate cannot express an invoice whose lines are taxed
   *    differently. Now that per-line VAT codes count, a document with a
   *    standard-rated and a zero-rated line has no single rate that
   *    reproduces its VAT, so the journal would not have matched the
   *    document the customer was sent.
   *  - The lookup was `treatment?.rate ?? 0`. A treatment renamed or
   *    deactivated between capture and approval silently zero-rated the
   *    posting: the whole gross went to Sales, no VAT Output line at all,
   *    no error raised — while the invoice itself still showed the VAT.
   *  - `vat_treatments.rate` is mutable. A rate change between capture and
   *    approval posted the new rate against the old total.
   *
   * The figures being used are the ones on the invoice, which are the
   * ones on the PDF, which are the ones the VAT report reads. They cannot
   * disagree, because there is only one of them. */
  const built = await buildJournalFromEvent(companyId, eventType, {
    grossAmount: invoice.total,
    // Retained for callers/rules that read it; the split below is what
    // the amounts are actually taken from.
    vatRatePercent: invoice.subtotal === 0 ? 0 : (invoice.vatAmount / invoice.subtotal) * 100,
    amounts: { gross: invoice.total, net: invoice.subtotal, vat: invoice.vatAmount },
    description: `${invoice.documentType} ${invoice.invoiceNumber}`,
  });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${invoice.invoiceNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    /* Phase 5J — the journal is dated the DOCUMENT's date, not today's.
     *
     * `createJournal` defaults `journalDate` to `new Date()` when the
     * caller omits one, and this caller omitted one. `posting_date` comes
     * from that date, and the trial balance, the financial statements and
     * the statutory VAT Return (which reads GL accounts 2100/2200 by
     * `posting_date`) all period-assign from it. So an invoice dated
     * 31 August but approved on 3 September recognised its revenue and
     * its output VAT in SEPTEMBER, while every document-based report put
     * it in August. The two could never reconcile, and the VAT201 for the
     * August period was understated by exactly that invoice.
     *
     * Consequence to be aware of: a document dated inside a closed or
     * locked financial period can no longer be posted — the Posting
     * Engine refuses it, the invoice honestly stays Approved-but-unposted
     * with the reason shown, and `retryPostInvoice` picks it up once the
     * period is reopened. That is the correct answer: the previous
     * behaviour did not avoid the problem, it silently posted the entry
     * into the wrong period instead. */
    journalDate: invoice.invoiceDate,
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
