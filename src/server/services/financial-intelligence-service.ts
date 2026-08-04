/**
 * Financial Intelligence — real, computed-from-`gl_transactions`/
 * `ae_journals` signals only: largest movements, possible duplicate
 * journals, missing postings, and unusual account growth. Explicitly NOT
 * a new AI/ML system — same honest framing as Transaction Explorer's
 * Recovery Panel (see `matching-engine.ts`'s own module docstring): every
 * `reasoning` string describes exactly what was computed, no more. No
 * reference-app equivalent exists — this is genuinely new capability.
 */

import * as glRepo from "@/server/repositories/gl-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import type { Journal, JournalStatus } from "@/server/accounting/types";
import type { GlTransactionWithContext } from "@/server/general-ledger/types";

// ---------------------------------------------------------------------
// Largest Movements
// ---------------------------------------------------------------------

export type LargestMovement = {
  transactionId: number;
  accountId: number;
  accountCode: string;
  accountDescription: string;
  postingDate: string;
  amount: number;
  description: string;
  reference: string;
  reasoning: string;
};

/** Pure — the top `topN` single postings by absolute amount within
 * whatever window the caller already fetched. */
export function findLargestMovements(transactions: GlTransactionWithContext[], topN: number): LargestMovement[] {
  return [...transactions]
    .map((t) => ({ transaction: t, amount: Math.max(t.debit, t.credit) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, Math.max(topN, 0))
    .map(({ transaction: t, amount }) => ({
      transactionId: t.id,
      accountId: t.accountId,
      accountCode: t.accountCode,
      accountDescription: t.accountDescription,
      postingDate: t.postingDate,
      amount,
      description: t.description,
      reference: t.reference,
      reasoning: `One of the largest single postings to ${t.accountCode} — ${t.accountDescription} in this period.`,
    }));
}

// ---------------------------------------------------------------------
// Possible Duplicate Journals
// ---------------------------------------------------------------------

export type PossibleDuplicateJournal = {
  accountId: number;
  accountCode: string;
  postingDate: string;
  side: "Debit" | "Credit";
  amount: number;
  occurrences: { transactionId: number; journalId: number; journalNumber: string }[];
  reasoning: string;
};

/** Pure — same pattern as the Matching Engine's real duplicate-payment
 * detection: same account + same date + same amount + same side,
 * appearing across two or more DIFFERENT journals (two lines of the same
 * journal landing on the same account/date/amount is a legitimate contra
 * entry, not a duplicate, and is deliberately not flagged). */
export function findPossibleDuplicateJournals(transactions: GlTransactionWithContext[]): PossibleDuplicateJournal[] {
  const groups = new Map<string, GlTransactionWithContext[]>();

  for (const t of transactions) {
    const side: "Debit" | "Credit" | null = t.debit > 0 ? "Debit" : t.credit > 0 ? "Credit" : null;
    if (!side) continue;
    const amount = side === "Debit" ? t.debit : t.credit;
    const key = `${t.accountId}|${t.postingDate}|${side}|${amount}`;
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }

  const duplicates: PossibleDuplicateJournal[] = [];
  for (const group of groups.values()) {
    const distinctJournalIds = new Set(group.map((t) => t.journalId));
    if (distinctJournalIds.size < 2) continue;

    const first = group[0];
    const side: "Debit" | "Credit" = first.debit > 0 ? "Debit" : "Credit";
    const amount = side === "Debit" ? first.debit : first.credit;
    duplicates.push({
      accountId: first.accountId,
      accountCode: first.accountCode,
      postingDate: first.postingDate,
      side,
      amount,
      occurrences: group.map((t) => ({ transactionId: t.id, journalId: t.journalId, journalNumber: t.journalNumber })),
      reasoning: `${distinctJournalIds.size} separate journals posted the same ${side.toLowerCase()} amount (${amount}) to ${first.accountCode} on ${first.postingDate} — worth checking for a duplicate.`,
    });
  }

  return duplicates.sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------
// Missing Postings
// ---------------------------------------------------------------------

export type MissingPostingAlert = {
  journalId: number;
  journalNumber: string;
  status: JournalStatus;
  ageDays: number;
  reasoning: string;
};

const MS_PER_DAY = 86_400_000;

/** Pure — flags journals that have been sitting still: Approved but not
 * yet run through the Posting Engine, or Draft and never submitted. */
export function findMissingPostings(
  approvedJournals: Pick<Journal, "id" | "journalNumber" | "status" | "createdAt">[],
  draftJournals: Pick<Journal, "id" | "journalNumber" | "status" | "createdAt">[],
  todayIso: string,
  approvedStaleDays: number,
  draftStaleDays: number,
): MissingPostingAlert[] {
  const todayMs = Date.parse(todayIso);
  const alerts: MissingPostingAlert[] = [];

  for (const j of approvedJournals) {
    const ageDays = Math.floor((todayMs - Date.parse(j.createdAt)) / MS_PER_DAY);
    if (ageDays >= approvedStaleDays) {
      alerts.push({
        journalId: j.id,
        journalNumber: j.journalNumber,
        status: j.status,
        ageDays,
        reasoning: `Approved ${ageDays} day(s) ago but still not posted — run Post Approved Journals or check what's blocking it.`,
      });
    }
  }

  for (const j of draftJournals) {
    const ageDays = Math.floor((todayMs - Date.parse(j.createdAt)) / MS_PER_DAY);
    if (ageDays >= draftStaleDays) {
      alerts.push({
        journalId: j.id,
        journalNumber: j.journalNumber,
        status: j.status,
        ageDays,
        reasoning: `Still a Draft after ${ageDays} day(s) — submit it for approval or cancel it.`,
      });
    }
  }

  return alerts.sort((a, b) => b.ageDays - a.ageDays);
}

// ---------------------------------------------------------------------
// Unusual Account Growth — moved to `growth-analysis.ts` (a zero-import
// pure file) so a Client Component can import `findUnusualGrowth`
// without pulling this file's server-only repository imports into the
// browser bundle; re-exported here unchanged so every existing caller
// keeps working.
// ---------------------------------------------------------------------

export { aggregateMovementsByAccount, findUnusualGrowth, shiftPeriodBack, type AccountMovement, type UnusualGrowthAlert } from "@/server/general-ledger/growth-analysis";
import { aggregateMovementsByAccount, findUnusualGrowth, shiftPeriodBack, type UnusualGrowthAlert } from "@/server/general-ledger/growth-analysis";

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------

export type FinancialIntelligenceOptions = {
  largestMovementsTopN?: number;
  growthThresholdPercent?: number;
  approvedStaleDays?: number;
  draftStaleDays?: number;
};

export type FinancialIntelligenceReport = {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  largestMovements: LargestMovement[];
  possibleDuplicateJournals: PossibleDuplicateJournal[];
  missingPostings: MissingPostingAlert[];
  unusualGrowth: UnusualGrowthAlert[];
  truncated: boolean;
};

export async function getFinancialIntelligence(
  companyId: string,
  dateFrom: string,
  dateTo: string,
  options: FinancialIntelligenceOptions = {},
): Promise<FinancialIntelligenceReport> {
  const previousPeriod = shiftPeriodBack(dateFrom, dateTo);

  const [current, previous, approvedJournals, draftJournals] = await Promise.all([
    glRepo.listGlTransactionsInRange(companyId, dateFrom, dateTo),
    glRepo.listGlTransactionsInRange(companyId, previousPeriod.dateFrom, previousPeriod.dateTo),
    journalRepo.listJournalsByStatus(companyId, "Approved"),
    journalRepo.listJournalsByStatus(companyId, "Draft"),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    dateFrom,
    dateTo,
    largestMovements: findLargestMovements(current.transactions, options.largestMovementsTopN ?? 10),
    possibleDuplicateJournals: findPossibleDuplicateJournals(current.transactions),
    missingPostings: findMissingPostings(approvedJournals, draftJournals, today, options.approvedStaleDays ?? 7, options.draftStaleDays ?? 14),
    unusualGrowth: findUnusualGrowth(
      aggregateMovementsByAccount(current.transactions),
      aggregateMovementsByAccount(previous.transactions),
      options.growthThresholdPercent ?? 50,
    ),
    truncated: current.truncated || previous.truncated,
  };
}
