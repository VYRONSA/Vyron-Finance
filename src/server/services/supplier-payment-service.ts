/**
 * Service layer for Supplier Payments — the other Purchasing document
 * type that posts through the real Posting Engine (see
 * `purchase-bill-service.ts`'s module docstring for the shared
 * architecture). Allocation reduces a specific bill's `outstanding`
 * without generating its own journal — the payment's own journal (DR
 * Creditors, CR Bank) already captures the full accounting effect;
 * allocation is a sub-ledger detail of *which* bill(s) it settled.
 * Mirrors `customer-receipt-service.ts` exactly.
 *
 * Allocation is deliberately not restricted to bills entered through
 * Purchasing — a payment can settle ANY outstanding bill regardless of
 * `origin`, matching how the existing Allocation Engine already treats
 * bills uniformly (see `0011_purchasing_platform.sql`'s header comment).
 */

import * as repo from "@/server/repositories/supplier-payment-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as billRepo from "@/server/repositories/purchase-bill-repository";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { queueCommunication } from "@/server/services/communication-service";
import { getCompany } from "@/server/services/company-service";
import { getSupplier } from "@/server/repositories/supplier-reconciliation-repository";
import { listSupplierContacts } from "@/server/repositories/supplier-management-repository";
import type { SupplierPayment } from "@/server/purchasing/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const listSupplierPayments = repo.listSupplierPayments;
export const listSupplierPaymentsBySupplier = repo.listSupplierPaymentsBySupplier;
export const getSupplierPayment = repo.getSupplierPayment;

export async function createSupplierPayment(companyId: string, input: repo.NewSupplierPayment): Promise<SupplierPayment> {
  if (!input.supplierId) throw new ValidationError("Supplier is required.");
  if (!input.paymentDate) throw new ValidationError("Payment date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  return repo.createSupplierPayment(companyId, input);
}

async function requirePayment(companyId: string, paymentId: number): Promise<SupplierPayment> {
  const payment = await repo.getSupplierPayment(companyId, paymentId);
  if (!payment) throw new NotFoundError(`No supplier payment with id ${paymentId}.`);
  return payment;
}

/** Approve AND post in one call, same "automatic" pattern as
 * `purchase-bill-service.ts::approveAndPostBill`. */
export async function approveAndPostPayment(companyId: string, paymentId: number): Promise<SupplierPayment> {
  const payment = await requirePayment(companyId, paymentId);
  if (payment.status !== "Draft") {
    throw new ValidationError(`Only a Draft payment can be approved (current status: ${payment.status}).`);
  }

  const built = await buildJournalFromEvent(companyId, "Supplier Payment", {
    grossAmount: payment.amount,
    vatRatePercent: 0,
    description: `Payment ${payment.paymentNumber}`,
  });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${payment.paymentNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Supplier Payment",
    description: `Payment ${payment.paymentNumber}${payment.reference ? ` — ${payment.reference}` : ""}`,
    reference: payment.reference || payment.paymentNumber,
    sourceType: "supplier_payment",
    sourceId: payment.id,
    status: "Approved",
    lines: built.lines,
  });

  await repo.approvePayment(companyId, paymentId, journal.id);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(
      `${payment.paymentNumber} was approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`,
    );
  }

  const posted = await repo.markPaymentPosted(companyId, paymentId);

  try {
    const supplier = await getSupplier(companyId, posted.supplierId);
    if (supplier) {
      const contacts = await listSupplierContacts(supplier.id);
      const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
      const company = await getCompany(companyId);
      await queueCommunication(companyId, {
        module: "Purchasing",
        businessObjectType: "Supplier",
        businessObjectId: supplier.id,
        channel: "Email",
        templateCode: "RemittanceAdvice",
        recipients: [{ type: "Supplier", id: supplier.id, name: supplier.name, address: contact?.email || null }],
        variables: {
          supplierName: supplier.name,
          amount: posted.amount.toFixed(2),
          paymentDate: posted.paymentDate,
          reference: posted.reference || posted.paymentNumber,
          companyName: company?.name,
        },
      });
    }
  } catch {
    // Communication failures must never break the primary operation.
  }

  return posted;
}

/** Recovery path for the one real gap `approveAndPostPayment` can leave
 * behind — mirrors `purchase-bill-service.ts::retryPostBill`. */
export async function retryPostPayment(companyId: string, paymentId: number): Promise<SupplierPayment> {
  const payment = await requirePayment(companyId, paymentId);
  if (payment.status !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted payment can retry posting (current status: ${payment.status}).`);
  }
  if (payment.journalId === null) throw new ValidationError(`${payment.paymentNumber} has no linked journal to post.`);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === payment.journalId);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === payment.journalId);
    throw new ValidationError(`${payment.paymentNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  return repo.markPaymentPosted(companyId, paymentId);
}

/** Workflow Completion Audit fix: `cancelPayment` used to be a raw
 * passthrough with no status check — mirrors the identical
 * `customer-receipt-service.ts::cancelReceipt` fix. A Posted payment has
 * a real journal and possibly real allocations against supplier bills;
 * cancelling it without a guard would silently corrupt the books if
 * called outside the current UI's own Draft-only gating. */
export async function cancelPayment(companyId: string, paymentId: number): Promise<SupplierPayment> {
  const payment = await requirePayment(companyId, paymentId);
  if (payment.status !== "Draft") {
    throw new ValidationError(`Only a Draft payment can be cancelled (current status: ${payment.status}).`);
  }
  return repo.cancelPayment(companyId, paymentId);
}

/** Real Supplier Allocations — how much of this payment is still
 * unallocated, and how much of the target bill is still outstanding, are
 * both checked before allocating so a payment can never be
 * over-allocated and a bill's outstanding can never go negative. */
export async function allocatePayment(companyId: string, paymentId: number, billId: number, amount: number): Promise<void> {
  if (amount <= 0) throw new ValidationError("Allocation amount must be greater than zero.");

  const payment = await requirePayment(companyId, paymentId);
  if (payment.status !== "Posted") throw new ValidationError("Only a Posted payment can be allocated.");

  const bill = await billRepo.getPurchaseBill(companyId, billId);
  if (!bill) throw new NotFoundError(`No bill with id ${billId}.`);
  if (bill.supplierId !== payment.supplierId) {
    throw new ValidationError("This payment and bill belong to different suppliers.");
  }

  const alreadyAllocated = round2(payment.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  const remainingOnPayment = round2(payment.amount - alreadyAllocated);
  if (amount > remainingOnPayment) {
    throw new ValidationError(`Cannot allocate ${amount} — only ${remainingOnPayment} remains unallocated on ${payment.paymentNumber}.`);
  }
  if (amount > bill.outstanding) {
    throw new ValidationError(`Cannot allocate ${amount} — ${bill.invoiceNumber} only has ${bill.outstanding} outstanding.`);
  }

  await repo.createPaymentAllocation(paymentId, billId, amount);
  await billRepo.reduceBillOutstanding(companyId, billId, amount);
}
