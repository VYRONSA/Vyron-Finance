/**
 * Service layer for VAT Returns — generated from live GL data (VAT
 * Input/Output account activity), reusing `account-activity-service.ts`
 * rather than a second GL query path. Every state change records into
 * the existing `automation_audit_log` (Module 7) — no new audit table.
 * "Do not implement electronic SARS submission yet... build a clean
 * submission interface ready for a future SARS integration": `submit`
 * below is real (Draft/Review/Approved -> Submitted, manual), and
 * `submissionMethod: 'SARS_eFiling'` is accepted by the schema and
 * exposed in the UI as a disabled option with an explanatory tooltip —
 * no fabricated submission logic exists behind it.
 */

import * as repo from "@/server/repositories/vat-return-repository";
import * as vatPaymentRepo from "@/server/repositories/vat-payment-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { getAccountActivity } from "@/server/services/account-activity-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { buildVatSettlementJournalLines, computeOutstandingBalance } from "@/server/vat/vat-engine";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import type { VatReturn } from "@/server/vat/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const VAT_INPUT_CODE = "2100";
const VAT_OUTPUT_CODE = "2200";

export const listVatReturns = repo.listVatReturns;
export const getVatReturn = repo.getVatReturn;

// Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding #201.
// `approveVatReturn`'s audit-log reason used to be keyed on whether the
// settlement lines balanced (`built.ok`), not on whether the journal
// actually posted — a return whose journal was skipped by the Posting
// Engine (e.g. a closed financial period) still got an audit entry
// claiming "Settlement journal posted to VAT Control." Pure and exported
// so this decision is directly unit-testable without a live database.
export function resolveVatApprovalAuditReason(
  settlementJournalId: number | undefined,
  postingSkipReason: string | undefined,
  built: { ok: true } | { ok: false; reason: string },
): string {
  if (settlementJournalId !== undefined) return "Settlement journal posted to VAT Control.";
  if (postingSkipReason) return postingSkipReason;
  return built.ok ? "Settlement journal was not posted." : built.reason;
}

/** Finding #202 — Box 14 "brought forward": the prior period's own
 * outstanding balance (its `netPayable` less whatever `VatPayment`s have
 * already settled it). Deliberately never negative on the return itself —
 * a still-unpaid prior liability shows up here; an over-collected prior
 * refund is a distinct receivable position that this platform does not
 * yet model as a rolling balance (see this module's own file-level
 * docstring on scope), so it is disclosed as zero rather than guessed. */
async function computeBroughtForward(companyId: string, periodStart: string): Promise<number> {
  const prior = await repo.findPriorVatReturn(companyId, periodStart);
  if (!prior || prior.netPayable <= 0) return 0;

  const priorPayments = await vatPaymentRepo.listVatPaymentsForReturn(companyId, prior.id);
  const alreadyPaid = priorPayments.reduce((sum, p) => sum + p.amount, 0);
  return computeOutstandingBalance(prior.netPayable, alreadyPaid);
}

async function computePeriodVat(companyId: string, periodStart: string, periodEnd: string) {
  const accounts = await listChartOfAccounts(companyId);
  const inputAccount = accounts.find((a) => a.accountCode === VAT_INPUT_CODE);
  const outputAccount = accounts.find((a) => a.accountCode === VAT_OUTPUT_CODE);
  if (!inputAccount || !outputAccount) {
    throw new ValidationError("VAT Input / VAT Output control accounts are not configured for this company.");
  }

  const [inputActivity, outputActivity] = await Promise.all([
    getAccountActivity(companyId, inputAccount.id, periodStart, periodEnd),
    getAccountActivity(companyId, outputAccount.id, periodStart, periodEnd),
  ]);

  const totalInputVat = Math.round(((inputActivity?.totalDebit ?? 0) - (inputActivity?.totalCredit ?? 0)) * 100) / 100;
  const totalOutputVat = Math.round(((outputActivity?.totalCredit ?? 0) - (outputActivity?.totalDebit ?? 0)) * 100) / 100;
  const netPayable = Math.round((totalOutputVat - totalInputVat) * 100) / 100;

  return { totalInputVat, totalOutputVat, netPayable };
}

export async function generateVatReturn(companyId: string, periodStart: string, periodEnd: string, performedBy: string): Promise<VatReturn> {
  if (periodStart > periodEnd) throw new ValidationError("Period start must be on or before period end.");
  const existing = await repo.findVatReturnForPeriod(companyId, periodStart, periodEnd);
  if (existing) throw new ValidationError(`A VAT Return already exists for this period (status: ${existing.status}). Use Recalculate instead.`);

  const [{ totalInputVat, totalOutputVat, netPayable }, broughtForward] = await Promise.all([
    computePeriodVat(companyId, periodStart, periodEnd),
    computeBroughtForward(companyId, periodStart),
  ]);
  const vatReturn = await repo.createVatReturn(companyId, { periodStart, periodEnd, totalInputVat, totalOutputVat, netPayable, broughtForward, generatedBy: performedBy });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatReturnGenerated",
    reason: `Generated from live VAT Input/Output account activity for ${periodStart} to ${periodEnd}.`,
    changes: { totalInputVat, totalOutputVat, netPayable, broughtForward },
    documentType: "VatReturn",
    documentId: vatReturn.id,
    isReversible: true,
  });

  return vatReturn;
}

export async function recalculateVatReturn(companyId: string, vatReturnId: number, performedBy: string): Promise<VatReturn> {
  const vatReturn = await repo.getVatReturn(companyId, vatReturnId);
  if (!vatReturn) throw new NotFoundError(`No VAT Return with id ${vatReturnId}.`);
  if (vatReturn.status !== "Draft") throw new ValidationError(`Only a Draft return can be recalculated (current status: ${vatReturn.status}).`);

  const { totalInputVat, totalOutputVat, netPayable } = await computePeriodVat(companyId, vatReturn.periodStart, vatReturn.periodEnd);
  const updated = await repo.updateVatReturnFigures(companyId, vatReturnId, { totalInputVat, totalOutputVat, netPayable });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatReturnRecalculated",
    reason: "Recalculated from live VAT Input/Output account activity.",
    changes: { totalInputVat, totalOutputVat, netPayable },
    documentType: "VatReturn",
    documentId: vatReturnId,
    isReversible: true,
  });

  return updated;
}

export async function moveToReview(companyId: string, vatReturnId: number, performedBy: string): Promise<VatReturn> {
  const vatReturn = await repo.getVatReturn(companyId, vatReturnId);
  if (!vatReturn) throw new NotFoundError(`No VAT Return with id ${vatReturnId}.`);
  if (vatReturn.status !== "Draft") throw new ValidationError(`Only a Draft return can move to Review (current status: ${vatReturn.status}).`);
  const updated = await repo.setVatReturnStatus(companyId, vatReturnId, "Review");
  await recordAuditEntry(companyId, { performedBy, actionType: "VatReturnMovedToReview", documentType: "VatReturn", documentId: vatReturnId });
  return updated;
}

/** Approving a return posts the real settlement journal — clears the
 * period's VAT Input/Output balances into VAT Control (2300) via
 * `vat-engine.ts::buildVatSettlementJournalLines`, through the same
 * `postApprovedJournals` Posting Engine every other document type uses. */
export async function approveVatReturn(companyId: string, vatReturnId: number, performedBy: string): Promise<VatReturn> {
  const vatReturn = await repo.getVatReturn(companyId, vatReturnId);
  if (!vatReturn) throw new NotFoundError(`No VAT Return with id ${vatReturnId}.`);
  if (vatReturn.status !== "Draft" && vatReturn.status !== "Review") {
    throw new ValidationError(`Only a Draft or Review return can be approved (current status: ${vatReturn.status}).`);
  }

  const built = buildVatSettlementJournalLines(vatReturn.totalOutputVat, vatReturn.totalInputVat, `VAT settlement for ${vatReturn.periodStart} to ${vatReturn.periodEnd}`);
  let settlementJournalId: number | undefined;

  // Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding
  // #201. The audit-log reason below used to be keyed on `built.ok` (did
  // the settlement lines balance?) rather than whether the journal
  // actually posted — so a return whose journal was skipped by the
  // Posting Engine (e.g. a closed financial period) still got an audit
  // entry claiming "Settlement journal posted to VAT Control." Track the
  // real skip reason here so the audit trail never asserts something
  // that didn't happen.
  let postingSkipReason: string | undefined;

  if (built.ok) {
    const journal = await journalRepo.createJournal(companyId, {
      journalType: "VAT Settlement",
      description: `VAT settlement for ${vatReturn.periodStart} to ${vatReturn.periodEnd}`,
      reference: `VAT-${vatReturn.id}`,
      sourceType: "vat_return",
      sourceId: vatReturn.id,
      status: "Approved",
      // Root Cause RC-1, Finding #184 — dated to the period the
      // settlement covers, not whenever it happened to be approved.
      journalDate: vatReturn.periodEnd,
      lines: built.lines,
    });
    const outcome = await postApprovedJournals(companyId);
    if (outcome.posted.some((j) => j.journalId === journal.id)) {
      settlementJournalId = journal.id;
    } else {
      postingSkipReason = outcome.skipped.find((s) => s.journalId === journal.id)?.reason ?? "The settlement journal was not posted.";
    }
  }

  const updated = await repo.setVatReturnStatus(companyId, vatReturnId, "Approved", { approvedBy: performedBy, ...(settlementJournalId !== undefined && { settlementJournalId }) });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatReturnApproved",
    reason: resolveVatApprovalAuditReason(settlementJournalId, postingSkipReason, built),
    journalIds: settlementJournalId ? [settlementJournalId] : [],
    documentType: "VatReturn",
    documentId: vatReturnId,
    isReversible: false,
  });

  return updated;
}

/** Real, manual submission — marks the return Submitted and records an
 * optional SARS reference number. No electronic SARS filing happens
 * here (see this file's module docstring); `submissionMethod` stays
 * `'Manual'` unless a future SARS integration sets it. */
export async function submitVatReturn(companyId: string, vatReturnId: number, performedBy: string, sarsReference?: string): Promise<VatReturn> {
  const vatReturn = await repo.getVatReturn(companyId, vatReturnId);
  if (!vatReturn) throw new NotFoundError(`No VAT Return with id ${vatReturnId}.`);
  if (vatReturn.status !== "Approved") throw new ValidationError(`Only an Approved return can be submitted (current status: ${vatReturn.status}).`);

  const updated = await repo.setVatReturnStatus(companyId, vatReturnId, "Submitted", {
    submittedAt: new Date().toISOString(),
    ...(sarsReference && { sarsReference }),
  });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatReturnSubmitted",
    reason: sarsReference ? `Marked submitted with reference ${sarsReference}.` : "Marked submitted.",
    documentType: "VatReturn",
    documentId: vatReturnId,
  });

  return updated;
}

/** Amendments require the original to already be Submitted — a return
 * that hasn't been filed yet should just be recalculated, not amended. */
export async function createAmendment(companyId: string, originalReturnId: number, performedBy: string): Promise<VatReturn> {
  const original = await repo.getVatReturn(companyId, originalReturnId);
  if (!original) throw new NotFoundError(`No VAT Return with id ${originalReturnId}.`);
  if (original.status !== "Submitted") throw new ValidationError("Only a Submitted return can be amended.");

  const { totalInputVat, totalOutputVat, netPayable } = await computePeriodVat(companyId, original.periodStart, original.periodEnd);
  const amendment = await repo.createVatReturn(companyId, {
    periodStart: original.periodStart,
    periodEnd: original.periodEnd,
    totalInputVat,
    totalOutputVat,
    netPayable,
    isAmendment: true,
    amendedReturnId: original.id,
    generatedBy: performedBy,
  });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "VatReturnAmended",
    reason: `Amendment of VAT Return #${original.id}.`,
    changes: { totalInputVat, totalOutputVat, netPayable },
    documentType: "VatReturn",
    documentId: amendment.id,
    isReversible: true,
  });

  return amendment;
}

export const updateVatReturnNotes = repo.updateVatReturnNotes;

export async function listVatControlAccountIds(companyId: string): Promise<{ inputAccountId: number | null; outputAccountId: number | null }> {
  const accounts = await listChartOfAccounts(companyId);
  return {
    inputAccountId: accounts.find((a) => a.accountCode === VAT_INPUT_CODE)?.id ?? null,
    outputAccountId: accounts.find((a) => a.accountCode === VAT_OUTPUT_CODE)?.id ?? null,
  };
}
