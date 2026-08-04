/**
 * Service layer for Supplier Bills entered through the Purchasing
 * workflow (Invoice/Credit Note/Debit Note — reusing `ImportedBill`'s
 * `documentType`, see `purchase-bill-repository.ts`'s module docstring
 * for why this is the same table Import Centre uses, not a new one).
 * The real integration point the Purchasing Platform exists for:
 * approving one of these resolves the matching seeded Posting Rule
 * ('Supplier Invoice'/'Supplier Credit Note', seeded in
 * 0007_general_ledger.sql) into a real journal, which flows through the
 * one Posting Engine — exactly mirroring
 * `sales-invoice-service.ts::approveAndPostInvoice`.
 *
 * A Debit Note reuses the 'Supplier Invoice' rule (identical DR
 * Purchases/DR VAT Input/CR Creditors shape) — no separate rule exists
 * or is needed, same as Sales' own Debit Notes.
 *
 * The bill's existing `vat_code` column (previously unused free text) is
 * repurposed to hold the VAT Treatment *code* actually used at creation,
 * so the exact rate can be re-resolved at approval time without adding a
 * new column — reusing what's real rather than duplicating it.
 */

import * as repo from "@/server/repositories/purchase-bill-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as orderRepo from "@/server/repositories/purchase-order-repository";
import { listAllBills as listAllBillsRepo } from "@/server/repositories/supplier-reconciliation-repository";
import { getSupplier } from "@/server/services/supplier-management-service";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import type { BillPostingStatus, ImportedBill } from "@/server/accounting/types";

/** Every bill company-wide, regardless of `origin` — Supplier Payments'
 * allocation UI needs the full set (imported or Purchasing-entered) to
 * let a payment settle any outstanding bill. Thin re-export of the
 * existing Supplier Reconciliation repository query — not a duplicated
 * data source. */
export const listAllBills = listAllBillsRepo;

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const EVENT_TYPE_BY_DOCUMENT: Record<ImportedBill["documentType"], string> = {
  Bill: "Supplier Invoice",
  "Debit Note": "Supplier Invoice",
  "Credit Note": "Supplier Credit Note",
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type CreatePurchaseBillInput = {
  supplierId: number;
  invoiceNumber: string;
  documentType?: ImportedBill["documentType"];
  invoiceDate: string;
  dueDate?: string | null;
  purchaseOrderId?: number | null;
  goodsReceivedNoteId?: number | null;
  glAccount?: string | null;
  vatTreatmentCode: string;
  subtotal: number;
};

export function validateBillInput(input: Pick<CreatePurchaseBillInput, "supplierId" | "invoiceNumber" | "invoiceDate" | "vatTreatmentCode" | "subtotal">): void {
  if (!input.supplierId) throw new ValidationError("Supplier is required.");
  if (!input.invoiceNumber?.trim()) throw new ValidationError("Invoice number is required.");
  if (!input.invoiceDate) throw new ValidationError("Invoice date is required.");
  if (!input.vatTreatmentCode) throw new ValidationError("VAT Treatment is required.");
  if (input.subtotal <= 0) throw new ValidationError("Amount must be greater than zero.");
}

export const listPurchaseBills = repo.listPurchaseBills;
export const listPurchaseBillsBySupplier = repo.listPurchaseBillsBySupplier;
export const getPurchaseBill = repo.getPurchaseBill;

export async function createPurchaseBill(companyId: string, input: CreatePurchaseBillInput): Promise<ImportedBill> {
  validateBillInput(input);
  const supplier = await getSupplier(companyId, input.supplierId);
  if (!supplier) throw new ValidationError(`No supplier with id ${input.supplierId}.`);

  const vatTreatments = await listVatTreatments(companyId);
  const treatment = vatTreatments.find((t) => t.code === input.vatTreatmentCode);
  if (!treatment) throw new ValidationError(`Unknown VAT treatment "${input.vatTreatmentCode}".`);

  return repo.createPurchaseBill(
    companyId,
    { ...input, supplierName: supplier.name, vatCode: treatment.code },
    input.subtotal,
    treatment.rate,
  );
}

const ALLOWED_TRANSITIONS: Record<BillPostingStatus, BillPostingStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Cancelled"],
  Approved: [],
  Posted: [],
  Cancelled: [],
};

export function canTransitionBillStatus(from: BillPostingStatus, to: BillPostingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

async function requireBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await repo.getPurchaseBill(companyId, billId);
  if (!bill) throw new NotFoundError(`No bill with id ${billId}.`);
  return bill;
}

function requirePostingStatus(bill: ImportedBill): BillPostingStatus {
  if (bill.postingStatus === null) {
    throw new ValidationError(`${bill.invoiceNumber} was imported, not entered through Purchasing, and is not part of the posting workflow.`);
  }
  return bill.postingStatus;
}

export async function submitBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (!canTransitionBillStatus(status, "Submitted")) {
    throw new ValidationError(`Cannot submit ${bill.invoiceNumber} from status ${status}.`);
  }
  return repo.submitBill(companyId, billId);
}

export async function cancelBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (!canTransitionBillStatus(status, "Cancelled")) {
    throw new ValidationError(`Cannot cancel ${bill.invoiceNumber} from status ${status}.`);
  }
  return repo.cancelBill(companyId, billId);
}

/** A Bill/Debit Note whose Purchase Order carries real stock items
 * already had its Inventory value capitalized at Goods Received time
 * (DR Inventory / CR GRNI Clearing — see `goods-received-note-service.ts`).
 * Billing it must clear that GRNI liability, not re-expense the same
 * amount through 'Supplier Invoice' — that would double-count. A Credit
 * Note against a stock-carrying order still uses 'Supplier Credit Note'
 * (a narrower, disclosed simplification — see MIGRATION_ROADMAP.md). */
async function resolveBillEventType(companyId: string, bill: ImportedBill): Promise<string> {
  if (bill.documentType !== "Credit Note" && bill.purchaseOrderId !== null) {
    const order = await orderRepo.getPurchaseOrder(companyId, bill.purchaseOrderId);
    if (order?.lines.some((line) => line.stockItemId !== null)) return "Inventory Bill";
  }
  return EVENT_TYPE_BY_DOCUMENT[bill.documentType];
}

/** Approve AND post in one call — same "automatic" pattern as
 * `sales-invoice-service.ts::approveAndPostInvoice`, including the
 * honest Approved-but-unposted fallback when the Posting Engine skips
 * the journal (e.g. a closed Financial Period). */
export async function approveAndPostBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (!canTransitionBillStatus(status, "Approved")) {
    throw new ValidationError(`Cannot approve ${bill.invoiceNumber} from status ${status}.`);
  }

  const vatTreatments = await listVatTreatments(companyId);
  const treatment = vatTreatments.find((t) => t.code === bill.vatCode);
  const vatRatePercent = treatment?.rate ?? 0;
  const eventType = await resolveBillEventType(companyId, bill);

  const built = await buildJournalFromEvent(companyId, eventType, {
    grossAmount: bill.total,
    vatRatePercent,
    description: `${bill.documentType} ${bill.invoiceNumber} — ${bill.supplierName}`,
  });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${bill.invoiceNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: bill.documentType,
    description: `${bill.documentType} ${bill.invoiceNumber} — ${bill.supplierName}`,
    reference: bill.invoiceNumber,
    sourceType: "purchase_bill",
    sourceId: bill.id,
    status: "Approved",
    lines: built.lines,
  });

  await repo.approveBill(companyId, billId, journal.id);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(
      `${bill.invoiceNumber} was approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`,
    );
  }

  return repo.markBillPosted(companyId, billId);
}

/** Recovery path for the one real gap `approveAndPostBill` can leave
 * behind — mirrors `sales-invoice-service.ts::retryPostInvoice`. */
export async function retryPostBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  if (bill.postingStatus !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted bill can retry posting (current status: ${bill.postingStatus ?? "not part of the posting workflow"}).`);
  }
  if (bill.journalId === null) throw new ValidationError(`${bill.invoiceNumber} has no linked journal to post.`);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === bill.journalId);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === bill.journalId);
    throw new ValidationError(`${bill.invoiceNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  return repo.markBillPosted(companyId, billId);
}

/** Real Order -> Bill conversion — "Purchase Orders can be billed" per
 * the completion standard. Mirrors
 * `sales-invoice-service.ts::createInvoiceFromOrder`. Requires the order
 * fully `Received` first, sums its lines into a single bill amount
 * (`ae_imported_bills` is header-only — see `purchase-bill-repository.ts`),
 * marks every line fully billed, and moves the order to `Billed`. */
export async function createBillFromOrder(
  companyId: string,
  orderId: number,
  invoiceNumber: string,
  invoiceDate: string,
  vatTreatmentCode: string,
): Promise<ImportedBill> {
  const order = await orderRepo.getPurchaseOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No purchase order with id ${orderId}.`);
  if (order.status !== "Received") {
    throw new ValidationError(`Only a Received order can be billed (current status: ${order.status}).`);
  }

  const subtotal = round2(order.lines.reduce((sum, l) => sum + l.lineTotal, 0));

  const bill = await createPurchaseBill(companyId, {
    supplierId: order.supplierId,
    invoiceNumber,
    invoiceDate,
    vatTreatmentCode,
    subtotal,
    purchaseOrderId: order.id,
  });

  for (const line of order.lines) {
    await orderRepo.incrementOrderLineQuantity(line.id, "billed_quantity", line.quantity);
  }
  await orderRepo.setOrderStatus(companyId, orderId, "Billed");

  return bill;
}
