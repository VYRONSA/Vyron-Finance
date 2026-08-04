/**
 * Service layer for VAT Adjustments — real, posts through the Posting
 * Engine via the 'VAT Adjustment Increase'/'VAT Adjustment Decrease'
 * posting rules, reusing `buildJournalFromEvent` (no duplicated
 * accounting logic). Large adjustments raise a real `LargeVatAdjustment`
 * VAT Exception, and every action records into the shared Audit Trail.
 */

import * as repo from "@/server/repositories/vat-adjustment-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import { raiseVatExceptionIdempotent } from "@/server/repositories/vat-exception-repository";
import type { VatAdjustment } from "@/server/vat/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const VAT_ACCOUNT_CODE: Record<"VATInput" | "VATOutput", string> = { VATInput: "2100", VATOutput: "2200" };
const LARGE_ADJUSTMENT_THRESHOLD = 10_000;

export const listVatAdjustments = repo.listVatAdjustments;
export const getVatAdjustment = repo.getVatAdjustment;

export async function createVatAdjustment(companyId: string, input: repo.NewVatAdjustment): Promise<VatAdjustment> {
  if (!input.reason?.trim()) throw new ValidationError("Reason is required.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new ValidationError("Amount must be greater than zero.");
  if (!input.adjustmentDate) throw new ValidationError("Adjustment date is required.");
  return repo.createVatAdjustment(companyId, { ...input, reason: input.reason.trim() });
}

/** Approve + post in one call — same "automatic" pattern used
 * throughout this codebase (`approveAndPostInvoice`, `approveAndPostBill`,
 * `approveAndPostTransaction`, ...). */
export async function approveAndPostAdjustment(companyId: string, adjustmentId: number, performedBy: string): Promise<VatAdjustment> {
  const adjustment = await repo.getVatAdjustment(companyId, adjustmentId);
  if (!adjustment) throw new NotFoundError(`No VAT adjustment with id ${adjustmentId}.`);
  if (adjustment.status !== "Draft") throw new ValidationError(`Only a Draft adjustment can be approved (current status: ${adjustment.status}).`);

  const eventType = adjustment.direction === "Increase" ? "VAT Adjustment Increase" : "VAT Adjustment Decrease";
  const built = await buildJournalFromEvent(companyId, eventType, {
    grossAmount: adjustment.amount,
    vatRatePercent: 0,
    description: adjustment.reason,
    accountsByRole: { vat_account: VAT_ACCOUNT_CODE[adjustment.targetAccount] },
  });
  if (!built.ok) throw new ValidationError(`Could not generate a journal for this adjustment: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "VAT Adjustment",
    description: adjustment.reason,
    reference: `VATADJ-${adjustment.id}`,
    sourceType: "vat_adjustment",
    sourceId: adjustment.id,
    status: "Approved",
    lines: built.lines,
  });

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((j) => j.journalId === journal.id);

  const updated = wasPosted ? await repo.approveVatAdjustment(companyId, adjustmentId, journal.id, performedBy) : adjustment;

  if (adjustment.amount >= LARGE_ADJUSTMENT_THRESHOLD) {
    await raiseVatExceptionIdempotent(companyId, {
      exceptionType: "LargeVatAdjustment",
      documentType: "VatAdjustment",
      documentId: adjustment.id,
      reason: `A VAT adjustment of ${adjustment.amount.toFixed(2)} exceeds the ${LARGE_ADJUSTMENT_THRESHOLD.toFixed(2)} materiality threshold.`,
      evidence: `${adjustment.direction} of ${adjustment.targetAccount} — ${adjustment.reason}`,
      recommendedAction: "Confirm this adjustment is correct and properly authorised before the VAT Return is approved.",
    });
  }

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatAdjustmentApproved",
    reason: adjustment.reason,
    journalIds: wasPosted ? [journal.id] : [],
    documentType: "VatAdjustment",
    documentId: adjustment.id,
    isReversible: false,
  });

  return updated;
}
