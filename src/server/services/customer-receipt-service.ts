/**
 * Service layer for Customer Receipts — the other Sales document type
 * that posts through the real Posting Engine (see
 * `sales-invoice-service.ts`'s module docstring for the shared
 * architecture). Allocation reduces a specific invoice's `outstanding`
 * without generating its own journal — the receipt's own journal (DR
 * Bank, CR Debtors) already captures the full accounting effect;
 * allocation is a sub-ledger detail of *which* invoice(s) it paid off.
 */

import * as repo from "@/server/repositories/customer-receipt-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as invoiceRepo from "@/server/repositories/sales-invoice-repository";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import type { CustomerReceipt } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const listCustomerReceipts = repo.listCustomerReceipts;
export const getCustomerReceipt = repo.getCustomerReceipt;

export async function createCustomerReceipt(companyId: string, input: repo.NewCustomerReceipt): Promise<CustomerReceipt> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.receiptDate) throw new ValidationError("Receipt date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  return repo.createCustomerReceipt(companyId, input);
}

async function requireReceipt(companyId: string, receiptId: number): Promise<CustomerReceipt> {
  const receipt = await repo.getCustomerReceipt(companyId, receiptId);
  if (!receipt) throw new NotFoundError(`No customer receipt with id ${receiptId}.`);
  return receipt;
}

/** Approve AND post in one call, same "automatic" pattern as
 * `sales-invoice-service.ts::approveAndPostInvoice`. */
export async function approveAndPostReceipt(companyId: string, receiptId: number): Promise<CustomerReceipt> {
  const receipt = await requireReceipt(companyId, receiptId);
  if (receipt.status !== "Draft") {
    throw new ValidationError(`Only a Draft receipt can be approved (current status: ${receipt.status}).`);
  }

  const built = await buildJournalFromEvent(companyId, "Customer Receipt", {
    grossAmount: receipt.amount,
    vatRatePercent: 0,
    description: `Receipt ${receipt.receiptNumber}`,
  });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${receipt.receiptNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Customer Receipt",
    description: `Receipt ${receipt.receiptNumber}${receipt.reference ? ` — ${receipt.reference}` : ""}`,
    reference: receipt.reference || receipt.receiptNumber,
    sourceType: "customer_receipt",
    sourceId: receipt.id,
    status: "Approved",
    lines: built.lines,
  });

  await repo.approveReceipt(companyId, receiptId, journal.id);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(
      `${receipt.receiptNumber} was approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`,
    );
  }

  return repo.markReceiptPosted(companyId, receiptId);
}

/** Workflow Completion Audit fix: `cancelReceipt` used to be a raw
 * passthrough to the repository with no status check — every sibling
 * cancel (`sales-invoice-service.ts::cancelInvoice`,
 * `sales-order-service.ts::cancelOrder`, `quotation-service.ts`) enforces
 * an explicit status guard before mutating; a Posted receipt has a real
 * journal and possibly real allocations, so cancelling it here (bypassing
 * a proper reversal) would silently corrupt the books if ever called
 * outside the current UI's own Draft-only gating (e.g. directly against
 * the API). */
export async function cancelReceipt(companyId: string, receiptId: number): Promise<CustomerReceipt> {
  const receipt = await requireReceipt(companyId, receiptId);
  if (receipt.status !== "Draft") {
    throw new ValidationError(`Only a Draft receipt can be cancelled (current status: ${receipt.status}).`);
  }
  return repo.cancelReceipt(companyId, receiptId);
}

/** Recovery path for the one real gap `approveAndPostReceipt` can leave
 * behind — same reasoning as `sales-invoice-service.ts::retryPostInvoice`. */
export async function retryPostReceipt(companyId: string, receiptId: number): Promise<CustomerReceipt> {
  const receipt = await requireReceipt(companyId, receiptId);
  if (receipt.status !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted receipt can retry posting (current status: ${receipt.status}).`);
  }
  if (receipt.journalId === null) {
    throw new ValidationError(`${receipt.receiptNumber} has no linked journal to post.`);
  }

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === receipt.journalId);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === receipt.journalId);
    throw new ValidationError(`${receipt.receiptNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  return repo.markReceiptPosted(companyId, receiptId);
}

/** Real Customer Allocations — how much of this receipt is still
 * unallocated, and how much of the target invoice is still outstanding,
 * are both checked before allocating so a receipt can never be
 * over-allocated and an invoice's outstanding can never go negative. */
export async function allocateReceipt(companyId: string, receiptId: number, invoiceId: number, amount: number): Promise<void> {
  if (amount <= 0) throw new ValidationError("Allocation amount must be greater than zero.");

  const receipt = await requireReceipt(companyId, receiptId);
  if (receipt.status !== "Posted") throw new ValidationError("Only a Posted receipt can be allocated.");

  const invoice = await invoiceRepo.getSalesInvoice(companyId, invoiceId);
  if (!invoice) throw new NotFoundError(`No sales invoice with id ${invoiceId}.`);
  if (invoice.customerId !== receipt.customerId) {
    throw new ValidationError("This receipt and invoice belong to different customers.");
  }

  const alreadyAllocated = round2(receipt.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  const remainingOnReceipt = round2(receipt.amount - alreadyAllocated);
  if (amount > remainingOnReceipt) {
    throw new ValidationError(`Cannot allocate ${amount} — only ${remainingOnReceipt} remains unallocated on ${receipt.receiptNumber}.`);
  }
  if (amount > invoice.outstanding) {
    throw new ValidationError(`Cannot allocate ${amount} — ${invoice.invoiceNumber} only has ${invoice.outstanding} outstanding.`);
  }

  await repo.createReceiptAllocation(receiptId, invoiceId, amount);
  await invoiceRepo.reduceInvoiceOutstanding(companyId, invoiceId, amount);
}
