/**
 * Journal authoring — create, edit, and duplicate. Deliberately separate
 * from `journal-service.ts` (Transaction Explorer's own Draft-generation
 * code path, left untouched) and `journal-workflow-service.ts` (status
 * transitions) — this file is the third piece: giving an accountant a way
 * to build a journal by hand in the first place, which neither of those
 * files does. Every journal this produces still lands in the same
 * `ae_journals`/`ae_journal_lines` tables and goes through the same
 * Approve -> Posting Engine path as any other journal.
 */

import * as journalRepo from "@/server/repositories/journal-repository";
import type { Journal } from "@/server/accounting/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const BALANCE_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type JournalLineInput = { accountCode: string; debit: number; credit: number; description: string };

/** Pure — unit tested. Ported balance rule from `journal-service.ts`
 * (`abs(totalDebit - totalCredit) <= 0.01`), plus the structural checks a
 * hand-entered journal needs that a machine-generated one (always exactly
 * one DR/CR pair per line) never violates by construction: at least 2
 * lines, every line has an account and exactly one of debit/credit. */
export function validateJournalLines(lines: JournalLineInput[]): void {
  if (lines.length < 2) throw new ValidationError("A journal needs at least two lines.");
  for (const line of lines) {
    if (!line.accountCode?.trim()) throw new ValidationError("Every line needs an account code.");
    if (line.debit < 0 || line.credit < 0) throw new ValidationError("Debit and credit amounts cannot be negative.");
    if (line.debit > 0 && line.credit > 0) throw new ValidationError("A line cannot have both a debit and a credit amount.");
    if (line.debit === 0 && line.credit === 0) throw new ValidationError("Every line needs a debit or credit amount.");
  }
  const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    throw new ValidationError(`Journal does not balance: total debit ${totalDebit} does not equal total credit ${totalCredit}.`);
  }
}

export type NewManualJournalRequest = {
  journalDate: string;
  journalType: string;
  description: string;
  reference?: string;
  lines: JournalLineInput[];
};

export async function createManualJournal(companyId: string, input: NewManualJournalRequest): Promise<Journal> {
  if (!input.journalDate?.trim()) throw new ValidationError("Journal date is required.");
  if (!input.description?.trim()) throw new ValidationError("Description is required.");
  validateJournalLines(input.lines);

  return journalRepo.createJournal(companyId, {
    journalDate: input.journalDate,
    journalType: input.journalType?.trim() || "Manual",
    description: input.description.trim(),
    reference: input.reference?.trim() ?? "",
    sourceType: "manual",
    sourceId: null,
    status: "Draft",
    lines: input.lines,
  });
}

export type EditJournalRequest = Partial<{
  journalDate: string;
  journalType: string;
  description: string;
  reference: string;
  lines: JournalLineInput[];
}>;

/** Only a Draft may be edited — every other status has already been acted
 * on by someone (submitted for approval, approved, posted…), so editing
 * it after the fact would silently invalidate that action's meaning. This
 * is a deliberate business rule, not a missing feature: the correct move
 * on an Approved-and-wrong journal is Cancel it and create a new one, or
 * (once Posted) Reverse it — both already real, separate actions. */
export async function updateJournal(companyId: string, journalId: number, input: EditJournalRequest): Promise<Journal> {
  const existing = await journalRepo.getJournal(companyId, journalId);
  if (!existing) throw new NotFoundError(`No journal with id ${journalId}.`);
  if (existing.status !== "Draft") {
    throw new ValidationError(`Only a Draft journal can be edited (current status: ${existing.status}).`);
  }
  if (input.lines) validateJournalLines(input.lines);
  if (input.description !== undefined && !input.description.trim()) throw new ValidationError("Description cannot be empty.");
  if (input.journalDate !== undefined && !input.journalDate.trim()) throw new ValidationError("Journal date cannot be empty.");

  return journalRepo.updateJournal(companyId, journalId, {
    ...(input.journalDate !== undefined && { journalDate: input.journalDate }),
    ...(input.journalType !== undefined && { journalType: input.journalType }),
    ...(input.description !== undefined && { description: input.description.trim() }),
    ...(input.reference !== undefined && { reference: input.reference.trim() }),
    ...(input.lines !== undefined && { lines: input.lines }),
  });
}

/** Copies a journal's lines into a brand-new Draft — never copies status,
 * audit stamps, or posting history, so the copy starts its own lifecycle
 * from scratch, dated today. */
export async function duplicateJournal(companyId: string, journalId: number): Promise<Journal> {
  const source = await journalRepo.getJournal(companyId, journalId);
  if (!source) throw new NotFoundError(`No journal with id ${journalId}.`);

  return journalRepo.createJournal(companyId, {
    journalDate: new Date().toISOString().slice(0, 10),
    journalType: source.journalType,
    description: `Copy of ${source.journalNumber} — ${source.description}`,
    reference: source.reference,
    sourceType: "manual",
    sourceId: null,
    status: "Draft",
    lines: source.lines.map((line) => ({ accountCode: line.accountCode, debit: line.debit, credit: line.credit, description: line.description })),
  });
}
