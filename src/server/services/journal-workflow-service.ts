/**
 * Journal workflow — Draft/Submitted/Approved/Rejected/Posted/Cancelled
 * status transitions, plus the Reversed flag. Builds on top of
 * `journal-service.ts` (Draft creation — untouched, still Transaction
 * Explorer's own "Generate Journal" code path) and `journal-repository.ts`
 * (extended with the transition functions this file calls) — this is
 * purely the workflow layer.
 *
 * User-confirmed design: keep the reference's proven 4 states
 * (Draft/Approved/Rejected/Posted), add 2 real new ones (Submitted,
 * Cancelled) with the transitions below; `Reversed` is deliberately not a
 * 7th status — it's the `isReversed` flag on the original journal, and
 * reversal creates a brand-new, separate, auto-approved offsetting
 * journal, exactly matching the reference's own
 * `posting_engine.reverse_journal` mechanic. Posting that reversal (like
 * any other Approved journal) is the posting engine's job
 * (`posting-engine-service.ts`) — this function never writes to
 * `gl_transactions` itself, so "one posting engine" still holds.
 */

import * as journalRepo from "@/server/repositories/journal-repository";
import type { Journal, JournalStatus } from "@/server/accounting/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const ALLOWED_TRANSITIONS: Record<JournalStatus, JournalStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Rejected", "Cancelled"],
  Approved: ["Posted", "Cancelled"],
  Rejected: [],
  Posted: [],
  Cancelled: [],
};

/** Pure — unit tested exhaustively since a bad transition here would let a
 * journal skip approval or get posted twice. */
export function canTransitionJournalStatus(from: JournalStatus, to: JournalStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export const listJournals = journalRepo.listJournals;
export const getJournal = journalRepo.getJournal;

async function requireJournal(companyId: string, journalId: number): Promise<Journal> {
  const journal = await journalRepo.getJournal(companyId, journalId);
  if (!journal) throw new NotFoundError(`No journal with id ${journalId}.`);
  return journal;
}

async function transition(
  companyId: string,
  journalId: number,
  to: JournalStatus,
  apply: (companyId: string, journalId: number) => Promise<Journal>,
): Promise<Journal> {
  const journal = await requireJournal(companyId, journalId);
  if (!canTransitionJournalStatus(journal.status, to)) {
    throw new ValidationError(`Cannot move journal ${journal.journalNumber} from ${journal.status} to ${to}.`);
  }
  return apply(companyId, journalId);
}

export const submitJournal = (companyId: string, journalId: number) => transition(companyId, journalId, "Submitted", journalRepo.submitJournal);
export const approveJournal = (companyId: string, journalId: number) => transition(companyId, journalId, "Approved", journalRepo.approveJournal);
export const rejectJournal = (companyId: string, journalId: number) => transition(companyId, journalId, "Rejected", journalRepo.rejectJournal);
export const cancelJournal = (companyId: string, journalId: number) => transition(companyId, journalId, "Cancelled", journalRepo.cancelJournal);

export type ReverseJournalOutcome = { original: Journal; reversal: Journal };

/** Ports `posting_engine.reverse_journal`: only a Posted, not-yet-reversed
 * journal can be reversed. Every line's debit/credit is swapped into a
 * brand-new journal, created Approved (matching the reference's
 * auto-approve-on-reversal behavior), and linked back via
 * `reversal_of_journal_id`/`reversed_by_journal_id`. */
export async function reverseJournal(companyId: string, journalId: number): Promise<ReverseJournalOutcome> {
  const original = await requireJournal(companyId, journalId);
  if (original.status !== "Posted") {
    throw new ValidationError(`Only a Posted journal can be reversed (current status: ${original.status}).`);
  }
  if (original.isReversed) {
    throw new ValidationError(`Journal ${original.journalNumber} has already been reversed.`);
  }
  if (original.lines.length === 0) {
    throw new ValidationError(`Journal ${original.journalNumber} has no lines to reverse.`);
  }

  const reversal = await journalRepo.createJournal(companyId, {
    journalType: "Reversal",
    description: `Reversal of ${original.journalNumber}`,
    reference: original.reference,
    sourceType: "journal_reversal",
    sourceId: original.id,
    status: "Approved",
    lines: original.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: line.credit,
      credit: line.debit,
      description: line.description,
    })),
  });

  await journalRepo.markJournalReversed(companyId, original.id, reversal.id);

  const refreshedOriginal = await requireJournal(companyId, original.id);
  return { original: refreshedOriginal, reversal };
}
