/**
 * The Posting Engine — the ONE place that ever moves an Approved journal
 * into `gl_transactions`. Ports `accounting/posting_engine.py`'s
 * `post_approved_journals` (select every Approved journal, post each in
 * one batch, stamp `posting_batch_id`) with one real addition the
 * reference never had: Financial Period validation
 * (`financial-period-service.ts::checkPostingDate`) — a journal whose date
 * falls in a Closed year or on/before its lock date is skipped and
 * reported, not silently posted, and does not fail the whole batch.
 *
 * "One posting engine, nothing bypasses it" is satisfied structurally:
 * every journal draft — however it was built (manual entry, Transaction
 * Explorer's `journal-service.ts::generateJournalFromTransactions`, or the
 * new Posting Rules engine) — already lands in the same
 * `ae_journals`/`ae_journal_lines` tables, so making Approved -> Posted
 * this single shared code path is enough; no other module writes to
 * `gl_transactions` directly.
 */

import * as journalRepo from "@/server/repositories/journal-repository";
import * as chartOfAccountsRepo from "@/server/repositories/chart-of-accounts-repository";
import * as postingRepo from "@/server/repositories/posting-repository";
import * as financialYearRepo from "@/server/repositories/financial-year-repository";
import { getCompany } from "@/server/repositories/company-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { checkPostingDate } from "@/server/services/financial-period-service";
import { computeFinancialPeriod, computeFinancialYearLabel } from "@/server/services/financial-year-service";
import type { Journal } from "@/server/accounting/types";
import type { PostingBatch } from "@/server/general-ledger/types";
import type { NewGlTransaction } from "@/server/repositories/posting-repository";

const BALANCE_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PostableJournal = Pick<Journal, "id" | "journalNumber" | "journalDate" | "reference" | "description" | "lines">;

export type NewGlTransactionRow = Omit<NewGlTransaction, "postedBy">;

export type BuildGlTransactionRowsResult = { ok: true; rows: NewGlTransactionRow[] } | { ok: false; reason: string };

/** Pure — the one place a bug would silently corrupt the ledger, so this
 * is exhaustively unit tested independently of Supabase. Rejects (rather
 * than defaulting or dropping a line) when the journal doesn't balance or
 * any line's account code has no Chart of Accounts entry. */
export function buildGlTransactionRowsForJournal(
  journal: PostableJournal,
  accountIdByCode: Map<string, number>,
  financialYearStartMonth: number,
): BuildGlTransactionRowsResult {
  if (journal.lines.length === 0) {
    return { ok: false, reason: `Journal ${journal.journalNumber} has no lines.` };
  }

  const totalDebit = round2(journal.lines.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(journal.lines.reduce((sum, l) => sum + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    return { ok: false, reason: `Journal ${journal.journalNumber} does not balance (debit ${totalDebit} != credit ${totalCredit}).` };
  }

  const financialYearLabel = computeFinancialYearLabel(journal.journalDate, financialYearStartMonth);
  const financialPeriod = computeFinancialPeriod(journal.journalDate, financialYearStartMonth);

  const rows: NewGlTransactionRow[] = [];
  for (const line of journal.lines) {
    const accountId = accountIdByCode.get(line.accountCode);
    if (accountId === undefined) {
      return { ok: false, reason: `Journal ${journal.journalNumber}: no Chart of Accounts entry for account code "${line.accountCode}".` };
    }
    rows.push({
      journalId: journal.id,
      journalLineId: line.id,
      accountId,
      postingDate: journal.journalDate,
      reference: journal.reference,
      description: line.description || journal.description,
      debit: line.debit,
      credit: line.credit,
      financialYearLabel,
      financialPeriod,
    });
  }

  return { ok: true, rows };
}

export type PostApprovedJournalsOutcome = {
  batch: PostingBatch | null;
  posted: { journalId: number; journalNumber: string }[];
  skipped: { journalId: number; journalNumber: string; reason: string }[];
};

/** Ports `posting_engine.post_approved_journals`: every currently
 * Approved journal is evaluated (period validation, then balance/account
 * validation) and either posted in this one batch or skipped-and-reported
 * — a single bad journal never blocks the rest of the batch. */
export async function postApprovedJournals(companyId: string): Promise<PostApprovedJournalsOutcome> {
  const approvedJournals = await journalRepo.listJournalsByStatus(companyId, "Approved");
  if (approvedJournals.length === 0) {
    return { batch: null, posted: [], skipped: [] };
  }

  const [accounts, company, financialYears] = await Promise.all([
    chartOfAccountsRepo.listChartOfAccounts(companyId),
    getCompany(companyId),
    financialYearRepo.listFinancialYears(companyId),
  ]);
  const accountIdByCode = new Map(accounts.map((a) => [a.accountCode, a.id]));
  const startMonth = company?.financialYearStartMonth ?? 3;

  const rows: NewGlTransactionRow[] = [];
  const posted: { journalId: number; journalNumber: string }[] = [];
  const skipped: { journalId: number; journalNumber: string; reason: string }[] = [];

  for (const journal of approvedJournals) {
    const dateCheck = checkPostingDate(financialYears, journal.journalDate);
    if (!dateCheck.ok) {
      skipped.push({ journalId: journal.id, journalNumber: journal.journalNumber, reason: dateCheck.reason });
      continue;
    }
    const built = buildGlTransactionRowsForJournal(journal, accountIdByCode, startMonth);
    if (!built.ok) {
      skipped.push({ journalId: journal.id, journalNumber: journal.journalNumber, reason: built.reason });
      continue;
    }
    rows.push(...built.rows);
    posted.push({ journalId: journal.id, journalNumber: journal.journalNumber });
  }

  if (posted.length === 0) {
    return { batch: null, posted, skipped };
  }

  const performedBy = await getPerformedByLabel();
  const batchNumber = await postingRepo.nextPostingBatchNumber(companyId);
  const batch = await postingRepo.createPostingBatch(companyId, {
    batchNumber,
    postingDate: new Date().toISOString().slice(0, 10),
    journalCount: posted.length,
    transactionCount: rows.length,
    postedBy: performedBy,
  });

  await postingRepo.insertGlTransactions(companyId, rows.map((r) => ({ ...r, postedBy: performedBy })));
  await postingRepo.markJournalsPosted(companyId, posted.map((p) => p.journalId), batch.id);

  return { batch, posted, skipped };
}
