/**
 * Service layer for VAT Payments — Finding #203. The VAT Control account
 * (2300) already receives the net Output/Input settlement on Approve
 * (`vat-return-service.ts::approveVatReturn`), but nothing ever cleared
 * it. `recordVatPayment` is the missing settlement step, mirroring
 * `supplier-payment-service.ts::approveAndPostPayment`'s DR-liability/
 * CR-bank pattern — collapsed to one atomic action since a SARS payment
 * has no internal Draft/Review workflow of its own (the return it settles
 * already went through one).
 */

import * as repo from "@/server/repositories/vat-payment-repository";
import * as vatReturnRepo from "@/server/repositories/vat-return-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { buildVatPaymentJournalLines, computeOutstandingBalance } from "@/server/vat/vat-engine";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import type { VatPayment } from "@/server/vat/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const listVatPaymentsForReturn = repo.listVatPaymentsForReturn;

export async function recordVatPayment(
  companyId: string,
  vatReturnId: number,
  input: { paymentDate: string; amount: number; bankAccountId?: number | null; reference?: string; notes?: string },
  performedBy: string,
): Promise<VatPayment> {
  if (!input.paymentDate) throw new ValidationError("Payment date is required.");
  if (!input.amount || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");

  const vatReturn = await vatReturnRepo.getVatReturn(companyId, vatReturnId);
  if (!vatReturn) throw new NotFoundError(`No VAT Return with id ${vatReturnId}.`);
  if (vatReturn.status !== "Approved" && vatReturn.status !== "Submitted") {
    throw new ValidationError(`Only an Approved or Submitted return can receive a payment (current status: ${vatReturn.status}).`);
  }
  if (vatReturn.settlementJournalId === null) {
    throw new ValidationError("This return's settlement journal never posted to VAT Control — there is nothing to pay yet.");
  }
  if (vatReturn.netPayable <= 0) {
    throw new ValidationError("This period is a refund position (SARS owes the company), not a payable — recording a payment is not applicable.");
  }

  const existingPayments = await repo.listVatPaymentsForReturn(companyId, vatReturnId);
  const alreadyPaid = round2(existingPayments.reduce((sum, p) => sum + p.amount, 0));
  const outstanding = computeOutstandingBalance(vatReturn.netPayable, alreadyPaid);
  if (outstanding <= 0) {
    throw new ValidationError(`This return is already fully paid (${vatReturn.netPayable} settled).`);
  }
  if (input.amount > outstanding) {
    throw new ValidationError(`Cannot record ${input.amount} — only ${outstanding} remains outstanding on this return.`);
  }

  const description = `VAT payment for ${vatReturn.periodStart} to ${vatReturn.periodEnd}`;
  const built = buildVatPaymentJournalLines(input.amount, description);
  if (!built.ok) throw new ValidationError(built.reason);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "VAT Payment",
    description,
    reference: `VATPAY-${vatReturnId}`,
    sourceType: "vat_payment",
    sourceId: vatReturnId,
    status: "Approved",
    journalDate: input.paymentDate,
    lines: built.lines,
  });

  const outcome = await postApprovedJournals(companyId);
  if (!outcome.posted.some((j) => j.journalId === journal.id)) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(`Payment journal could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  const payment = await repo.createVatPayment(companyId, {
    vatReturnId,
    bankAccountId: input.bankAccountId ?? null,
    paymentDate: input.paymentDate,
    amount: input.amount,
    reference: input.reference,
    notes: input.notes,
    journalId: journal.id,
    createdBy: performedBy,
  });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatPaymentRecorded",
    reason: `Recorded a payment of ${input.amount} against VAT Return #${vatReturnId}.`,
    changes: { amount: input.amount, outstandingBefore: outstanding },
    journalIds: [journal.id],
    documentType: "VatReturn",
    documentId: vatReturnId,
    isReversible: false,
  });

  return payment;
}
