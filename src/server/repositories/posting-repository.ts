/**
 * Repository layer for the Posting Engine — `posting_batches` and the
 * append-only `gl_transactions` ledger itself (see
 * `supabase/migrations/0007_general_ledger.sql`). Nothing outside
 * `posting-engine-service.ts` should import this file: it's the one place
 * that ever writes to `gl_transactions`, matching the reference's own
 * stated invariant for `general_ledger.py`.
 */

import { createClient } from "@/lib/supabase/server";
import { postingBatchFromRow, type PostingBatchRow } from "@/server/general-ledger/mappers";
import type { PostingBatch } from "@/server/general-ledger/types";

/** Sequential, per-company, `COUNT(*)+1` — same pattern as
 * `journal-repository.ts::nextJournalNumber`; `posting_batches`'
 * `unique (company_id, batch_number)` is the same race backstop. */
export async function nextPostingBatchNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("posting_batches")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) throw error;
  return `PB${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export type NewGlTransaction = {
  journalId: number;
  journalLineId: number;
  accountId: number;
  postingDate: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  financialYearLabel: string;
  financialPeriod: number;
  postedBy: string;
};

export type PostApprovedJournalsResult = {
  batch: PostingBatch | null;
  claimedJournalIds: number[];
};

type PostApprovedJournalsRpcRow = {
  batch: PostingBatchRow | null;
  claimedJournalIds: number[];
};

// Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding #041.
// `createPostingBatch`/`insertGlTransactions`/`markJournalsPosted` used to
// be three separate, non-transactional calls here — a real race (two
// concurrent posting runs could both claim the same Approved journal) and
// a real partial-failure risk (a journal marked Posted with no matching
// gl_transactions, or vice versa, if one call succeeded and the next
// failed). `fn_post_approved_journals` (0063_atomic_journal_posting.sql)
// does the whole claim-batch-insert sequence as one atomic DB statement;
// this is now the only way `posting-engine-service.ts` writes a posting
// batch. Balance/account/period validation is still computed in pure
// TypeScript beforehand (`buildGlTransactionRowsForJournal`,
// `checkPostingDate`) and only the pre-validated rows are ever passed in —
// this migration makes the write atomic, it doesn't move validation into
// SQL.
export async function postApprovedJournalsAtomic(
  companyId: string,
  journalIds: number[],
  glRows: NewGlTransaction[],
  batchNumber: string,
  postingDate: string,
  postedBy: string,
): Promise<PostApprovedJournalsResult> {
  if (journalIds.length === 0) return { batch: null, claimedJournalIds: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_post_approved_journals", {
    p_company_id: companyId,
    p_journal_ids: journalIds,
    p_gl_rows: glRows.map((r) => ({
      journalId: r.journalId,
      journalLineId: r.journalLineId,
      accountId: r.accountId,
      postingDate: r.postingDate,
      reference: r.reference,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      financialYearLabel: r.financialYearLabel,
      financialPeriod: r.financialPeriod,
    })),
    p_batch_number: batchNumber,
    p_posting_date: postingDate,
    p_posted_by: postedBy,
  });
  if (error) throw error;
  // Untyped RPC result — see `gl-repository.ts::getTrialBalanceRows`'s own
  // note on why this is cast directly rather than `.returns<T>()`.
  const result = data as unknown as PostApprovedJournalsRpcRow;
  return {
    batch: result.batch ? postingBatchFromRow(result.batch) : null,
    claimedJournalIds: result.claimedJournalIds ?? [],
  };
}

export type PostedBankJournal = {
  id: number;
  journalNumber: string;
  journalDate: string;
  transactionIds: number[];
};

export type PostBankTransactionsResult = {
  batch: PostingBatch | null;
  journals: PostedBankJournal[];
  claimedTransactionIds: number[];
};

type PostBankTransactionsRpcRow = {
  batch: PostingBatchRow | null;
  journals: { id: number; journalNumber: string; journalDate: string; transactionIds: number[] }[];
  claimedTransactionIds: number[];
};

/**
 * Bank Accounting Posting — the counterpart of
 * `postApprovedJournalsAtomic` for transactions coming out of Transaction
 * Explorer, and like it the ONLY way this path writes to
 * `gl_transactions`. `fn_post_bank_transactions`
 * (0092_bank_posting_and_duplicate_preserving_import.sql) does the whole
 * sequence — claim the transactions, create the journals and their lines,
 * open the posting batch, write the ledger, back-link every transaction
 * to the journal and batch that carried it — as one atomic statement.
 *
 * Two properties this buys, neither of which separate PostgREST calls can
 * provide: a transaction can never be posted twice (the claim only takes
 * rows still `posted_flag = false and journal_id is null` at the instant
 * it runs), and a transaction can never end up flagged posted with no
 * ledger entries behind it, or ledger entries with no flag in front of
 * them. Balance, chart-of-accounts and financial-period validation stay in
 * pure, unit-tested TypeScript (`bank-posting-service.ts`) and only
 * pre-validated journals are passed in — the two checks repeated inside
 * the function are backstops that abort the write, not the primary
 * validation.
 */
export async function postBankTransactionsAtomic(
  companyId: string,
  transactionIds: number[],
  journals: {
    journalNumber: string;
    journalDate: string;
    journalType: string;
    description: string;
    reference: string;
    financialYearLabel: string;
    financialPeriod: number;
    transactionIds: number[];
    lines: { transactionId: number; accountCode: string; debit: number; credit: number; description: string }[];
  }[],
  batchNumber: string,
  postingDate: string,
  postedBy: string,
): Promise<PostBankTransactionsResult> {
  if (transactionIds.length === 0 || journals.length === 0) return { batch: null, journals: [], claimedTransactionIds: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_post_bank_transactions", {
    p_company_id: companyId,
    p_transaction_ids: transactionIds,
    p_journals: journals,
    p_batch_number: batchNumber,
    p_posting_date: postingDate,
    p_posted_by: postedBy,
  });
  if (error) throw error;
  // Untyped RPC result — see `gl-repository.ts::getTrialBalanceRows`'s own
  // note on why this is cast directly rather than `.returns<T>()`.
  const result = data as unknown as PostBankTransactionsRpcRow;
  return {
    batch: result.batch ? postingBatchFromRow(result.batch) : null,
    journals: result.journals ?? [],
    claimedTransactionIds: result.claimedTransactionIds ?? [],
  };
}
