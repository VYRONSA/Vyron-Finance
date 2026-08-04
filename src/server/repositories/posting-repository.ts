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

export type NewPostingBatch = {
  batchNumber: string;
  postingDate: string;
  journalCount: number;
  transactionCount: number;
  postedBy: string;
};

export async function createPostingBatch(companyId: string, input: NewPostingBatch): Promise<PostingBatch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posting_batches")
    .insert({
      company_id: companyId,
      batch_number: input.batchNumber,
      posting_date: input.postingDate,
      journal_count: input.journalCount,
      transaction_count: input.transactionCount,
      posted_by: input.postedBy,
    })
    .select("*")
    .single<PostingBatchRow>();
  if (error) throw error;
  return postingBatchFromRow(data);
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

export async function insertGlTransactions(companyId: string, rows: NewGlTransaction[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("gl_transactions").insert(
    rows.map((r) => ({
      company_id: companyId,
      journal_id: r.journalId,
      journal_line_id: r.journalLineId,
      account_id: r.accountId,
      posting_date: r.postingDate,
      reference: r.reference,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      financial_year_label: r.financialYearLabel,
      financial_period: r.financialPeriod,
      posted_by: r.postedBy,
    })),
  );
  if (error) throw error;
}

export async function markJournalsPosted(companyId: string, journalIds: number[], postingBatchId: number): Promise<void> {
  if (journalIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("ae_journals")
    .update({ status: "Posted", posted_at: new Date().toISOString(), posting_batch_id: postingBatchId })
    .eq("company_id", companyId)
    .in("id", journalIds);
  if (error) throw error;
}
