/**
 * Repository layer for the General Ledger's read side — Trial Balance, GL
 * Inquiry, and Account Activity. `gl_transactions` is append-only (see
 * `posting-repository.ts`'s header comment); this file never writes to
 * it. Pagination is keyset (seek), not OFFSET — same reasoning as
 * `transaction-explorer-repository.ts`.
 */

import { createClient } from "@/lib/supabase/server";
import {
  glTransactionFromRow,
  glTransactionWithContextFromRow,
  trialBalanceRowFromRpcRow,
  type GlTransactionRow,
  type GlTransactionWithContextRow,
  type TrialBalanceRpcRow,
} from "@/server/general-ledger/mappers";
import type { GlInquiryCursor, GlInquiryFilters, GlTransaction, GlTransactionWithContext, TrialBalanceRow } from "@/server/general-ledger/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

/** RC1 Phase 6 — the Operations Centre's Posting Engine health has no
 * real execution log to read (confirmed by research), so the newest
 * `gl_transactions.posted_at` is the one honest "last activity" signal
 * this engine's own output can provide. */
export async function getLastPostedAt(companyId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gl_transactions")
    .select("posted_at")
    .eq("company_id", companyId)
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ posted_at: string }>();
  if (error) throw error;
  return data?.posted_at ?? null;
}

export async function getTrialBalanceRows(companyId: string, asOfDate: string | null): Promise<TrialBalanceRow[]> {
  const supabase = await createClient();
  // Not `.returns<T[]>()` — this client has no generated Database type, so
  // an untyped RPC's builder infers a "single row" shape that conflicts
  // with an array cast at the type level (same reason
  // `transaction-explorer-repository.ts`'s RPC call uses `.single<T>()`
  // instead); casting the resolved `data` directly sidesteps it.
  const { data, error } = await supabase.rpc("fn_trial_balance", { p_company_id: companyId, p_as_of_date: asOfDate });
  if (error) throw error;
  return ((data ?? []) as TrialBalanceRpcRow[]).map(trialBalanceRowFromRpcRow);
}

/** Same delimiter-stripping rationale as
 * `transaction-explorer-repository.ts::sanitizeFilterValue`. */
function sanitizeFilterValue(text: string): string {
  return text.replace(/[,()\\]/g, "").trim().slice(0, 200);
}

const GL_SELECT =
  "*, chart_of_accounts!inner(account_code, description, branch_id, department_id, cost_centre_id), ae_journals!inner(journal_number, source_type)";

export type GlQueryResult = {
  transactions: GlTransactionWithContext[];
  nextRawCursor: GlInquiryCursor | null;
  hasMore: boolean;
};

export async function queryGlTransactions(
  companyId: string,
  filters: GlInquiryFilters,
  cursor: GlInquiryCursor | null,
  limit: number,
): Promise<GlQueryResult> {
  const supabase = await createClient();
  let query = supabase.from("gl_transactions").select(GL_SELECT).eq("company_id", companyId);

  if (filters.dateFrom) query = query.gte("posting_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("posting_date", filters.dateTo);
  if (filters.accountId !== null) query = query.eq("account_id", filters.accountId);
  if (filters.reference) query = query.ilike("reference", `%${sanitizeFilterValue(filters.reference)}%`);
  if (filters.search) {
    const term = sanitizeFilterValue(filters.search);
    if (term) query = query.or(`description.ilike.%${term}%,reference.ilike.%${term}%`);
  }
  if (filters.branchId !== null) query = query.eq("chart_of_accounts.branch_id", filters.branchId);
  if (filters.departmentId !== null) query = query.eq("chart_of_accounts.department_id", filters.departmentId);
  if (filters.costCentreId !== null) query = query.eq("chart_of_accounts.cost_centre_id", filters.costCentreId);
  if (filters.sourceType) query = query.eq("ae_journals.source_type", filters.sourceType);

  if (cursor) {
    query = query.or(`posting_date.lt.${cursor.postingDate},and(posting_date.eq.${cursor.postingDate},id.lt.${cursor.id})`);
  }

  query = query.order("posting_date", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);

  const { data, error } = await query.returns<GlTransactionWithContextRow[]>();
  if (error) throw error;

  const hasMore = data.length > limit;
  const page = hasMore ? data.slice(0, limit) : data;
  const transactions = page.map(glTransactionWithContextFromRow);
  const last = page.at(-1);
  const nextRawCursor = hasMore && last ? { postingDate: last.posting_date, id: last.id } : null;

  return { transactions, nextRawCursor, hasMore };
}

/** Every posting for one account within a date range, ascending — the raw
 * material for Account Activity's movements list and monthly trend. Scoped
 * to a single account and typically a single financial year, so (unlike
 * GL Inquiry) a plain ordered fetch is safe without keyset pagination. */
export async function getAccountTransactionsInRange(
  companyId: string,
  accountId: number,
  dateFrom: string,
  dateTo: string,
): Promise<GlTransaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gl_transactions")
    .select("*")
    .eq("company_id", companyId)
    .eq("account_id", accountId)
    .gte("posting_date", dateFrom)
    .lte("posting_date", dateTo)
    .order("posting_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(LIST_CAP)
    .returns<GlTransactionRow[]>();
  if (error) throw error;
  return data.map(glTransactionFromRow);
}

export type GlTransactionsInRangeResult = { transactions: GlTransactionWithContext[]; truncated: boolean };

/** Every posting company-wide within a (bounded, recent) date range — the
 * raw material for Financial Intelligence's signals, which look at a
 * recent window (e.g. the last 90 days), not the whole ledger history.
 * Capped, not silently: `truncated` tells the caller when `cap` was hit so
 * a report can say "showing signals from the most recent N postings" if
 * it ever needs to. */
export async function listGlTransactionsInRange(
  companyId: string,
  dateFrom: string,
  dateTo: string,
  cap = 5000,
): Promise<GlTransactionsInRangeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gl_transactions")
    .select(GL_SELECT)
    .eq("company_id", companyId)
    .gte("posting_date", dateFrom)
    .lte("posting_date", dateTo)
    .order("posting_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(cap + 1)
    .returns<GlTransactionWithContextRow[]>();
  if (error) throw error;
  const truncated = data.length > cap;
  const rows = truncated ? data.slice(0, cap) : data;
  return { transactions: rows.map(glTransactionWithContextFromRow), truncated };
}

export type AccountBalanceTotals = { totalDebit: number; totalCredit: number };

export async function getAccountBalanceBefore(companyId: string, accountId: number, beforeDate: string): Promise<AccountBalanceTotals> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_account_balance_before", {
    p_company_id: companyId,
    p_account_id: accountId,
    p_before_date: beforeDate,
  });
  if (error) throw error;
  const rows = (data ?? []) as { total_debit: number; total_credit: number }[];
  const row = rows[0];
  return { totalDebit: Number(row?.total_debit ?? 0), totalCredit: Number(row?.total_credit ?? 0) };
}
