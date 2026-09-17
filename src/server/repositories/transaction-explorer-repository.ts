/**
 * Repository layer for Transaction Explorer — the only layer allowed to
 * speak Supabase for this module. Pagination is keyset (seek), not
 * OFFSET, ported from `accounting_engine/transaction_explorer_service.py`'s
 * own explicit design choice: OFFSET pagination measured ~5s at row
 * 99,000 there vs. tens-of-ms for a seek — the difference matters at the
 * "100,000+ transactions" scale this module is required to support, and
 * only grows worse with OFFSET as data accumulates.
 */

import { createClient } from "@/lib/supabase/server";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import {
  allocationHistoryFromRow,
  bankTransactionFromRow,
  matchHistoryFromRow,
  reviewHistoryFromRow,
  type AllocationHistoryRow,
  type BankTransactionRow,
  type MatchHistoryRow,
  type ReviewHistoryRow,
} from "@/server/accounting/mappers";
import type {
  AllocationHistoryEntry,
  BankTransactionRecord,
  MatchHistoryEntry,
  ReviewHistoryEntry,
  ReviewStatus,
  TransactionExplorerCursor,
  TransactionExplorerFilters,
  TransactionExplorerSummary,
  TransactionPostingStatus,
} from "@/server/accounting/types";
import { allocationFilterExcludesPosted } from "@/server/accounting/types";

export type TransactionQueryResult = {
  transactions: BankTransactionRecord[];
  nextRawCursor: TransactionExplorerCursor | null;
  hasMore: boolean;
};

const SORT_COLUMNS: Record<TransactionExplorerFilters["sortBy"], string> = {
  transactionDate: "transaction_date",
  debit: "debit",
  credit: "credit",
};

const TRANSACTION_SELECT = "*, matched_supplier:ae_suppliers(name)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

/** PostgREST's `.or()`/`.and()` filter strings use `,()` as structural
 * delimiters — strip them (and backslashes) from user-supplied search text
 * so a search term can never reshape the filter it's meant to be a value
 * within. Not full LIKE-escaping (no ESCAPE clause is exposed by
 * supabase-js for this), but sufficient for real-world search terms
 * (names, references, descriptions) and safe by construction otherwise —
 * RLS still scopes every row to the caller's own company regardless. */
function sanitizeFilterValue(text: string): string {
  return text.replace(/[,()\\]/g, "").trim().slice(0, 200);
}

/** One PostgREST `or()` term per workflow state. `and(...)` groups are
 * PostgREST's own syntax for combining predicates inside an `or` — the
 * same construction the keyset cursor below already uses.
 *
 * `is_allocated` is the generated column from migration 0092, not an
 * ad hoc `suggested_gl_account is not null` written here: the empty
 * string an accountant produces by CLEARING an allocation is not null,
 * so a hand-written predicate would classify a cleared row as Ready to
 * Post while `transactionPostingStatus` classifies it as Unprocessed.
 * Deriving it once in the database is what keeps the filter and the
 * badge in agreement. */
function postingStatusPredicate(status: TransactionPostingStatus): string {
  switch (status) {
    case "Reconciled":
      return "reconciliation_id.not.is.null";
    case "Posted":
      return "and(posted_flag.is.true,reconciliation_id.is.null)";
    case "Ready to Post":
      return "and(posted_flag.is.false,reconciliation_id.is.null,is_allocated.is.true)";
    case "Unprocessed":
      return "and(posted_flag.is.false,reconciliation_id.is.null,is_allocated.is.false)";
  }
}

export async function queryTransactions(
  companyId: string,
  filters: TransactionExplorerFilters,
  cursor: TransactionExplorerCursor | null,
  limit: number,
): Promise<TransactionQueryResult> {
  const supabase = await createClient();
  const sortColumn = SORT_COLUMNS[filters.sortBy];
  const ascending = filters.sortDirection === "asc";

  let query = supabase.from("ae_bank_transactions").select(TRANSACTION_SELECT).eq("company_id", companyId);

  if (filters.search) {
    const term = sanitizeFilterValue(filters.search);
    if (term) {
      query = query.or(`description.ilike.%${term}%,reference.ilike.%${term}%,beneficiary.ilike.%${term}%,notes.ilike.%${term}%`);
    }
  }
  if (filters.dateFrom) query = query.gte("transaction_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("transaction_date", filters.dateTo);
  if (filters.minAmount !== null) query = query.or(`debit.gte.${filters.minAmount},credit.gte.${filters.minAmount}`);
  if (filters.maxAmount !== null) query = query.or(`debit.lte.${filters.maxAmount},credit.lte.${filters.maxAmount}`);
  if (filters.statuses && filters.statuses.length > 0) {
    query = query.in("allocation_status", filters.statuses);
    // Posting is terminal: a transaction already in the General Ledger is
    // not what "Allocated" means any more (see `countsAsAllocated`). The
    // one exception is an explicit request for posted/reconciled rows on
    // the posting axis, which must still be honoured.
    if (allocationFilterExcludesPosted(filters)) {
      query = query.eq("posted_flag", false).is("reconciliation_id", null);
    }
  }
  if (filters.bankAccountId !== null) query = query.eq("bank_account_id", filters.bankAccountId);
  if (filters.importBatch) query = query.eq("import_batch", filters.importBatch);
  if (filters.duplicateOnly) query = query.eq("required_action", REQUIRED_ACTION_DUPLICATE_PAYMENT);
  if (filters.unknownSupplierOnly) query = query.is("matched_supplier_id", null);

  // Phase 23A (Find & Recode) — additive filters over existing columns,
  // AND-combined with everything above (never OR'd into `search`'s own
  // broader match) so "Description contains X AND Current account is Y"
  // works exactly as the feature requires.
  if (filters.description) {
    const term = sanitizeFilterValue(filters.description);
    if (term) query = query.ilike("description", `%${term}%`);
  }
  if (filters.reference) {
    const term = sanitizeFilterValue(filters.reference);
    if (term) query = query.ilike("reference", `%${term}%`);
  }
  if (filters.glAccount) query = query.eq("suggested_gl_account", filters.glAccount);
  if (filters.supplierId !== null && filters.supplierId !== undefined) query = query.eq("matched_supplier_id", filters.supplierId);
  if (filters.customerId !== null && filters.customerId !== undefined) query = query.eq("matched_customer_id", filters.customerId);
  if (filters.allocationMethods && filters.allocationMethods.length > 0) query = query.in("allocation_method", filters.allocationMethods);
  if (filters.hasRule === true) query = query.not("rule_id", "is", null);
  else if (filters.hasRule === false) query = query.is("rule_id", null);
  if (filters.manualOverrideOnly) query = query.eq("is_manual_override", true);
  if (filters.needsReviewOnly) query = query.not("required_action", "is", null);

  // Bank Accounting Posting — the four workflow states, expressed as
  // PostgREST predicates over the same real columns
  // `transactionPostingStatus` reads (`posted_flag`, `reconciliation_id`,
  // `suggested_gl_account`, `is_split`). Single-state filtering is done
  // in SQL so it works across the whole company, not just the loaded
  // page; a multi-state selection is a plain OR of those same predicates.
  if (filters.postingStatuses && filters.postingStatuses.length > 0 && filters.postingStatuses.length < 4) {
    query = query.or(filters.postingStatuses.map(postingStatusPredicate).join(","));
  }

  if (cursor) {
    const op = ascending ? "gt" : "lt";
    const value = cursor.sortValue === null ? "null" : cursor.sortValue;
    query = query.or(`${sortColumn}.${op}.${value},and(${sortColumn}.eq.${value},id.${op}.${cursor.id})`);
  }

  query = query.order(sortColumn, { ascending }).order("id", { ascending }).limit(limit + 1);

  const { data, error } = await query.returns<BankTransactionRow[]>();
  if (error) throw error;

  const hasMore = data.length > limit;
  const page = hasMore ? data.slice(0, limit) : data;
  const transactions = page.map(bankTransactionFromRow);

  const last = page.at(-1);
  const nextSortValue = last ? (filters.sortBy === "transactionDate" ? last.transaction_date : Number(last[sortColumn as "debit" | "credit"])) : null;
  const nextRawCursor: TransactionExplorerCursor | null = hasMore && last ? { sortValue: nextSortValue, id: last.id } : null;

  return { transactions, nextRawCursor, hasMore };
}

export async function getTransactionSummary(companyId: string): Promise<TransactionExplorerSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_transaction_explorer_summary", { p_company_id: companyId }).single<{
    total_transactions: number;
    matched: number;
    unmatched: number;
    awaiting_review: number;
    journals_created: number;
    total_value: number;
  }>();
  if (error) throw error;
  return {
    totalTransactions: Number(data.total_transactions),
    matched: Number(data.matched),
    unmatched: Number(data.unmatched),
    awaitingReview: Number(data.awaiting_review),
    journalsCreated: Number(data.journals_created),
    totalValue: Number(data.total_value),
  };
}

export type BankingAutomationAggregate = {
  totalTransactions: number;
  automated: number;
  imported: number;
  importedMatched: number;
  importedRuleApplied: number;
  importedRuleSucceeded: number;
  importedWithConfidence: number;
  importedConfidenceSum: number;
};

/** Launch Blocker fix (post-RC2 Product Review Board directive): the one
 * server-side aggregate `buildBankingAutomationSummary`/
 * `buildMatchingSummary` now run against, instead of pulling a company's
 * entire bank transaction history into application memory via
 * `listTransactionsForExport` and reducing it in JavaScript — the exact
 * pattern RC2's own load testing proved doesn't scale (linear cost with
 * transaction count, worse given the platform's 1,000-row-per-request
 * cap). See migration 0039_banking_automation_aggregate.sql. */
export async function getBankingAutomationAggregate(companyId: string): Promise<BankingAutomationAggregate> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_banking_automation_summary", { p_company_id: companyId }).single<{
    total_transactions: number;
    automated: number;
    imported: number;
    imported_matched: number;
    imported_rule_applied: number;
    imported_rule_succeeded: number;
    imported_with_confidence: number;
    imported_confidence_sum: number;
  }>();
  if (error) throw error;
  return {
    totalTransactions: Number(data.total_transactions),
    automated: Number(data.automated),
    imported: Number(data.imported),
    importedMatched: Number(data.imported_matched),
    importedRuleApplied: Number(data.imported_rule_applied),
    importedRuleSucceeded: Number(data.imported_rule_succeeded),
    importedWithConfidence: Number(data.imported_with_confidence),
    importedConfidenceSum: Number(data.imported_confidence_sum),
  };
}

export type UnmatchedTransactionForQueue = {
  id: number;
  description: string;
  reference: string;
  allocationStatus: string;
  debit: number;
  credit: number;
  transactionDate: string;
  confidenceScore: number | null;
};

/** Launch Blocker fix, part 3: `getMatchingQueue`'s "every unmatched
 * item must appear" listing used a plain filtered+sorted+limited SELECT
 * (via `queryTransactions`), which is the right tool for the
 * interactive Transaction Explorer UI but not for this — RLS must
 * evaluate `user_can_access_company()` once per row satisfying the
 * WHERE clause before it can even determine the sort order, and a
 * company with a large "still needs review" backlog (worst case:
 * hundreds of thousands of rows) made that real. Proven live: 14.9s
 * through RLS at 800,000 matching rows (a real correctness failure —
 * the request timed out) vs. 0.56s via this `security definer` RPC
 * (0041_unmatched_transactions_queue_rpc.sql), which checks access
 * once instead of per-row. */
type UnmatchedTransactionRpcRow = {
  id: number;
  description: string;
  reference: string;
  allocation_status: string;
  debit: number;
  credit: number;
  transaction_date: string;
  confidence_score: number | null;
  has_more: boolean;
};

/** `data` is cast directly rather than using `.returns<T[]>()` — an
 * untyped RPC's builder infers a "single row" shape that conflicts with
 * an array cast at the type level, same rationale as
 * `gl-repository.ts::getTrialBalance`'s own identical comment. */
export async function listUnmatchedTransactionsForQueue(companyId: string, limit: number): Promise<{ transactions: UnmatchedTransactionForQueue[]; hasMore: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_unmatched_bank_transactions", { p_company_id: companyId, p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as UnmatchedTransactionRpcRow[];
  return {
    transactions: rows.map((r) => ({
      id: r.id,
      description: r.description,
      reference: r.reference,
      allocationStatus: r.allocation_status,
      debit: Number(r.debit),
      credit: Number(r.credit),
      transactionDate: r.transaction_date,
      confidenceScore: r.confidence_score === null ? null : Number(r.confidence_score),
    })),
    hasMore: rows[0]?.has_more ?? false,
  };
}

export type RecentTransactionForDuplicateCheck = { id: number; transactionDate: string; debit: number; credit: number; beneficiary: string };
type RecentTransactionRpcRow = { id: number; transaction_date: string; debit: number; credit: number; beneficiary: string };

/** Launch Blocker fix, part 4: same rationale as
 * `listUnmatchedTransactionsForQueue` above — a plain date-range SELECT
 * on `ae_bank_transactions` paid the same per-row RLS cost (2.4s to
 * return zero rows in live testing, since no index supported a pure
 * `company_id` + `transaction_date` range query). See migration
 * 0043_recent_transactions_for_duplicate_check_rpc.sql. */
export async function listRecentTransactionsForDuplicateCheck(companyId: string, dateFrom: string, dateTo: string, limit: number): Promise<RecentTransactionForDuplicateCheck[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_recent_bank_transactions_for_duplicate_check", { p_company_id: companyId, p_date_from: dateFrom, p_date_to: dateTo, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as RecentTransactionRpcRow[]).map((r) => ({
    id: r.id,
    transactionDate: r.transaction_date,
    debit: Number(r.debit),
    credit: Number(r.credit),
    beneficiary: r.beneficiary,
  }));
}

export async function getTransaction(companyId: string, transactionId: number): Promise<BankTransactionRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .eq("id", transactionId)
    .maybeSingle<BankTransactionRow>();
  if (error) throw error;
  return data ? bankTransactionFromRow(data) : null;
}

/** Every transaction the Rule Engine hasn't yet resolved to a journal.
 * Capped by the API's 1,000-row limit — the Rule Engine sweep pages
 * through `listRuleEngineWorklistPage` instead; this remains for the
 * explicit "apply to remaining" action. */
export async function listUnprocessedTransactions(companyId: string): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .is("journal_id", null)
    .order("transaction_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

/** Cursor for `listRuleEngineWorklistPage`: the last row's sort date (a
 * missing transaction date sorts as `infinity`) and id. */
export type RuleEngineWorklistCursor = { sortDate: string; id: number };

export const RULE_ENGINE_WORKLIST_PAGE_MAX = 1000;

export function ruleEngineWorklistCursorAfter(row: Pick<BankTransactionRecord, "transactionDate" | "id">): RuleEngineWorklistCursor {
  return { sortDate: row.transactionDate || "infinity", id: row.id };
}

/** Migration 0100 — one keyset page of the Rule Engine's worklist
 * (`journal_id IS NULL`), newest transaction date first, then id. With
 * `claimableOnly`, only transactions a Banking Rule may still take
 * (`fn_bank_transaction_is_claimable_by_rule`). Pages never overlap and
 * rows posted mid-run cannot shift them, so repeated calls reach every
 * row however long the worklist is. */
export async function listRuleEngineWorklistPage(
  companyId: string,
  options: { claimableOnly: boolean; after: RuleEngineWorklistCursor | null; limit: number },
): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("fn_list_rule_engine_worklist", {
      p_company_id: companyId,
      p_claimable_only: options.claimableOnly,
      p_after_sort_date: options.after?.sortDate ?? null,
      p_after_id: options.after?.id ?? null,
      p_limit: Math.min(Math.max(options.limit, 0), RULE_ENGINE_WORKLIST_PAGE_MAX),
    })
    .select(TRANSACTION_SELECT);
  if (error) throw error;
  // Untyped RPC result — same convention as the other RPC readers here.
  return ((data ?? []) as unknown as BankTransactionRow[]).map(bankTransactionFromRow);
}

/** Migration 0100 — transactions whose Banking Rule journal is Posted and
 * unreversed but whose link is missing (the 2151 state), found directly
 * rather than by walking the worklist. */
export async function listRuleEngineRecoveryCandidates(companyId: string, limit: number): Promise<BankTransactionRecord[]> {
  if (limit <= 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("fn_list_rule_engine_recovery_candidates", { p_company_id: companyId, p_limit: Math.min(limit, RULE_ENGINE_WORKLIST_PAGE_MAX) })
    .select(TRANSACTION_SELECT);
  if (error) throw error;
  // Untyped RPC result — same convention as the other RPC readers here.
  return ((data ?? []) as unknown as BankTransactionRow[]).map(bankTransactionFromRow);
}

/** How many transactions have no journal yet (the sweep's whole worklist). */
export async function countUnprocessedTransactions(companyId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ae_bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("journal_id", null);
  if (error) throw error;
  return count ?? 0;
}

/** Phase 26E — the AI Classification Sweep's own worklist, the company-
 * wide counterpart to `classifyUnallocatedTransactionsWithAi`'s existing
 * caller-supplied-id-list shape (`import-service.ts`/`bank-sync-service.ts`
 * always already know exactly which rows they just created; a scheduled
 * sweep of EXISTING/historical rows has no such list and needs to find
 * its own candidates). The WHERE clause mirrors
 * `isEligibleForAiClassification` field-for-field (never a second
 * eligibility definition — this is a query-level restatement of the exact
 * same check, purely so the database can filter instead of this function
 * fetching every transaction in the company to filter in memory) AND the
 * atomic RPC's own claim WHERE clause (migration 0083/0084) is still the
 * true, final authority at write time regardless of what this query
 * returns — a row selected here that becomes ineligible a moment later
 * (a Banking Rule, a manual action, another concurrent sweep) simply
 * fails its RPC claim and is silently left alone, exactly like every
 * other caller of `classifyUnallocatedTransactionsWithAi` already
 * tolerates. Ordered oldest-first so a historical backlog drains in
 * import order across repeated scheduler passes, not an arbitrary order
 * that could revisit the same rows before reaching older ones. `limit`
 * is always passed as `MAX_AI_CLASSIFICATIONS_PER_RUN` by the caller —
 * this function itself has no opinion on batch size, matching this
 * repository's existing convention of leaving policy constants to the
 * service layer. */
export async function listAiClassificationEligibleTransactions(companyId: string, limit: number): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .eq("allocation_status", "Unallocated")
    .is("suggested_gl_account", null)
    .is("rule_id", null)
    .is("matched_supplier_id", null)
    .is("matched_customer_id", null)
    .is("matched_merchant_id", null)
    .is("journal_id", null)
    .eq("is_manual_override", false)
    // Migration 0094 — never offer the sweep a transaction a person is
    // holding for review. The database guard in
    // `fn_apply_ai_classification` would refuse the write anyway; this
    // stops the run wasting an AI provider call to find that out, and
    // keeps `hasMoreEligible` honest about what is genuinely left.
    .eq("review_hold", false)
    .is("review_status", null)
    .is("required_action", null)
    .order("transaction_date", { ascending: true })
    .limit(limit)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

/** Phase 28 — company historical evidence for the accounting-confidence
 * layer (`@/server/ai/transaction-classification/company-historical-evidence.ts`).
 * Deliberately narrow, bounded, and read-only: only the columns the
 * evidence aggregator actually reads, `.eq("company_id", companyId)`
 * first (never a global/cross-tenant scan — see the Phase 28 forensic
 * report's own explicit multi-tenant requirement), a real `limit` (never
 * unbounded — "avoid loading thousands of transactions," same report),
 * and only rows that were actually resolved to a real GL account
 * (`suggested_gl_account is not null`) — an unresolved transaction has
 * nothing to teach this lookup. `descriptionPrefix` matches against
 * BOTH `description` and `beneficiary` (this codebase's own data shows
 * the two are usually identical, but never assume which one is
 * populated) via `ilike` — safe here specifically because every value
 * ever passed in comes from `KNOWN_NARRATION_PREFIXES`
 * (`narration-pattern.ts`), a fixed literal vocabulary with no
 * user-supplied or `%`/`_` wildcard characters, never from row/user
 * input. `excludeTransactionId` keeps a transaction from ever counting
 * as its own historical evidence when reclassified. */
export async function listHistoricalAllocationsForPattern(
  companyId: string,
  descriptionPrefix: string,
  direction: "Debit" | "Credit",
  amountMin: number,
  amountMax: number | null,
  excludeTransactionId: number,
  limit: number,
): Promise<
  { suggestedGlAccount: string | null; ruleId: number | null; isManualOverride: boolean; allocationMethod: string | null }[]
> {
  const supabase = await createClient();
  const amountColumn = direction === "Debit" ? "debit" : "credit";
  let query = supabase
    .from("ae_bank_transactions")
    .select("suggested_gl_account, rule_id, is_manual_override, allocation_method")
    .eq("company_id", companyId)
    .neq("id", excludeTransactionId)
    .not("suggested_gl_account", "is", null)
    .or(`description.ilike.${descriptionPrefix}%,beneficiary.ilike.${descriptionPrefix}%`)
    .gte(amountColumn, amountMin)
    .limit(limit);
  if (amountMax !== null) query = query.lt(amountColumn, amountMax);

  const { data, error } = await query.returns<
    { suggested_gl_account: string | null; rule_id: number | null; is_manual_override: boolean; allocation_method: string | null }[]
  >();
  if (error) throw error;
  return data.map((row) => ({
    suggestedGlAccount: row.suggested_gl_account,
    ruleId: row.rule_id,
    isManualOverride: row.is_manual_override,
    allocationMethod: row.allocation_method,
  }));
}

/** Master Implementation Tracker — Epic E2, Finding #086. "Select
 * Similar" only ever operated against the currently loaded page (50
 * rows), silently missing matches elsewhere. Rearchitecting selection
 * to span pages is a much larger change (the whole bulk-action bar
 * derives its selection from the loaded `transactions` array — see the
 * RC-17 investigation notes) than this finding's scope calls for; the
 * smallest correct fix is to stop the gap being *silent* — this count
 * lets the client compare "matched on this page" against "matched
 * company-wide" and disclose the difference instead of hiding it. */
export async function countMatchingTransactions(
  companyId: string,
  criterion: "merchant" | "description" | "amount" | "reference",
  value: string | number,
): Promise<number> {
  const supabase = await createClient();
  let query = supabase.from("ae_bank_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (criterion === "merchant") query = query.eq("beneficiary", value as string);
  else if (criterion === "description") query = query.eq("description", value as string);
  else if (criterion === "reference") query = query.eq("reference", value as string);
  else query = query.or(`debit.eq.${value},credit.eq.${value}`);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Master Implementation Tracker — Epic E2, Finding #089. Company-wide
 * merchant allocation stats, replacing the Merchant Intelligence
 * Panel's previous "this page only" computation (deliberately
 * disclosed at the time, but a real product gap — see the RC-17
 * investigation notes). Bounded by `LIST_CAP` like every other
 * unbounded list query in this repository. */
export async function listTransactionsByBeneficiary(companyId: string, beneficiary: string): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .eq("beneficiary", beneficiary)
    .order("transaction_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

export async function getTransactionsByIds(companyId: string, transactionIds: number[]): Promise<BankTransactionRecord[]> {
  if (transactionIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .in("id", transactionIds)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

/** The reverse of `journal.sourceId`/`sourceType` for the
 * `bank_transactions_bulk` case: `journal-service.ts::
 * generateJournalFromTransactions` links transactions to their journal via
 * `ae_bank_transactions.journal_id`, not a `source_id` on the journal
 * (since one journal can cover many transactions) — this is how the
 * General Ledger side (GL Inquiry, Account Activity, a journal's own
 * detail) traces a posting back to the original bank transaction(s) it
 * came from, completing the Bank Transaction -> Journal -> GL chain in
 * the other direction. */
export async function getTransactionsByJournalId(companyId: string, journalId: number): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .eq("journal_id", journalId)
    .limit(LIST_CAP)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

/** Phase 27 — Production Readiness Audit found these three history
 * lookups filtered only by `transaction_id`, never `company_id`, even
 * though every one of these tables carries a `company_id` column
 * (written at insert time). Not currently exploitable — the one caller,
 * `getTransactionDetail`, already proves `transactionId` belongs to
 * `companyId` via `repo.getTransaction(companyId, transactionId)` before
 * any of these run — but a repository function with no tenant guard of
 * its own is a defense-in-depth gap: any future caller that skips that
 * upstream check would leak another company's audit-history rows for a
 * guessed/enumerated transaction id. Added here for the same reason
 * every OTHER query in this file is company-scoped, not because a live
 * leak was found. */
export async function listMatchHistory(companyId: string, transactionId: number): Promise<MatchHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_match_history")
    .select("*")
    .eq("company_id", companyId)
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true })
    .returns<MatchHistoryRow[]>();
  if (error) throw error;
  return data.map(matchHistoryFromRow);
}

export async function listAllocationHistory(companyId: string, transactionId: number): Promise<AllocationHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_allocation_history")
    .select("*")
    .eq("company_id", companyId)
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true })
    .returns<AllocationHistoryRow[]>();
  if (error) throw error;
  return data.map(allocationHistoryFromRow);
}

export async function listReviewHistory(companyId: string, transactionId: number): Promise<ReviewHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_transaction_review_history")
    .select("*")
    .eq("company_id", companyId)
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true })
    .returns<ReviewHistoryRow[]>();
  if (error) throw error;
  return data.map(reviewHistoryFromRow);
}

export async function applyReview(
  companyId: string,
  transactionId: number,
  newStatus: ReviewStatus,
  note: string,
  performedBy: string,
): Promise<BankTransactionRecord> {
  const supabase = await createClient();
  const current = await getTransaction(companyId, transactionId);
  if (!current) throw new Error(`No transaction with id ${transactionId}`);

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("ae_bank_transactions")
    .update({ review_status: newStatus, reviewed_by: performedBy, reviewed_at: now, review_note: note })
    .eq("company_id", companyId)
    .eq("id", transactionId);
  if (updateError) throw updateError;

  const { error: historyError } = await supabase.from("ae_transaction_review_history").insert({
    company_id: companyId,
    transaction_id: transactionId,
    previous_review_status: current.reviewStatus,
    new_review_status: newStatus,
    note,
    performed_by: performedBy,
  });
  if (historyError) throw historyError;

  const updated = await getTransaction(companyId, transactionId);
  if (!updated) throw new Error(`No transaction with id ${transactionId}`);
  return updated;
}

/** Phase 25I — `guardPostedTransactions` repeats a `journal_id IS NULL`
 * condition in the UPDATE's own WHERE clause (the same conditional-claim
 * discipline `applyAiClassification` already established two functions
 * below), for the ONE narrow gap this shared helper's callers can have:
 * Find & Recode's `bulkRecodeX` functions re-validate "still unposted"
 * moments before calling this, but without this guard, a transaction
 * posted in the split-second between that re-validation and this UPDATE
 * would still be silently recoded — contradicting the feature's own
 * documented "posted transactions are protected" guarantee at the one
 * layer that actually enforces it durably.
 *
 * Phase 27 — Production Readiness Audit found the OLD `false` default
 * left a real gap: the plain `bulkAssignX` functions below (the ordinary
 * Transaction Explorer bulk-action-bar buttons and the inline-grid
 * `allocateRow` path) had NO posted-transaction guard at all — unlike
 * Find & Recode, nothing stopped a user from re-assigning the GL account,
 * supplier, customer, or VAT code on an ALREADY-POSTED transaction,
 * silently desynchronizing the bank transaction's allocation metadata
 * from the journal already sitting in the GL. "Posted transactions are
 * immutable" has been a documented, enforced invariant everywhere else
 * in this codebase (migration 0082's own guard for AI classification,
 * Find & Recode's double enforcement) — there was never a legitimate
 * reason for the PLAIN manual-assign path alone to be the one exception.
 * Defaulting to `true` closes this for every current and future caller
 * that doesn't explicitly opt out; every existing Find & Recode caller
 * already passes `true` explicitly, so this changes no existing
 * behavior for them. */
/** Phase 29 — "Never create duplicate allocation history entries for a
 * no-op save." Re-committing a row with the identical value it already
 * had (a blur firing on a row nothing was actually changed on, an
 * Accept click on an AI suggestion already accepted, a second Save
 * click) used to still insert a new `ae_allocation_history` row every
 * time, since history was previously built from "which ids did the
 * UPDATE touch" alone, with no previous-vs-new comparison. Each
 * `hasXChanged` predicate below is the ONE check that matters for its
 * own field(s) — pure and exported (no Supabase involved) specifically
 * so this logic is directly unit-testable without mocking the DB client,
 * matching this codebase's own established convention of extracting
 * decision logic into small pure functions (`computeMatchStatus`,
 * `needsAiAcceptAction`, etc.) rather than only integration-testing it. */
export function hasGlAssignmentChanged(previous: BankTransactionRecord, glAccount: string): boolean {
  return previous.suggestedGlAccount !== glAccount || previous.allocationStatus !== "Allocated" || previous.allocationMethod !== "Manual" || !previous.isManualOverride;
}

export function hasSupplierAssignmentChanged(previous: BankTransactionRecord, supplierId: number): boolean {
  return previous.matchedSupplierId !== supplierId || previous.allocationStatus !== "Allocated" || previous.allocationMethod !== "Manual" || !previous.isManualOverride;
}

export function hasCustomerAssignmentChanged(previous: BankTransactionRecord, customerId: number): boolean {
  return previous.matchedCustomerId !== customerId || previous.allocationStatus !== "Allocated" || previous.allocationMethod !== "Manual" || !previous.isManualOverride;
}

export function hasVatAssignmentChanged(previous: BankTransactionRecord, vatCode: string): boolean {
  return previous.suggestedVatCode !== vatCode;
}

export function hasVatRecodeChanged(previous: BankTransactionRecord, vatCode: string): boolean {
  return previous.suggestedVatCode !== vatCode || previous.allocationMethod !== "Manual" || !previous.isManualOverride;
}

export function hasMerchantAssignmentChanged(previous: BankTransactionRecord, merchantId: number): boolean {
  return previous.matchedMerchantId !== merchantId;
}

/** `hasRealChange` lets each caller of the shared core below supply the
 * predicate that actually matters for its own field(s) — defaulting to
 * "always a real change" for any caller that doesn't need this (none
 * currently omit it, but this keeps the shared core's contract
 * additive, not breaking). The `.update()` itself still runs for the
 * whole batch either way — re-writing an identical value is a harmless,
 * idempotent no-op — only the audit-history INSERT is filtered. */
async function bulkUpdateWithAllocationHistory(
  companyId: string,
  transactionIds: number[],
  update: Record<string, unknown>,
  historyFields: (previous: BankTransactionRecord) => Record<string, unknown>,
  performedBy: string,
  guardPostedTransactions = true,
  hasRealChange: (previous: BankTransactionRecord) => boolean = () => true,
): Promise<{ updatedIds: number[] }> {
  const supabase = await createClient();
  const previousRows = await getTransactionsByIds(companyId, transactionIds);

  let query = supabase.from("ae_bank_transactions").update(update).eq("company_id", companyId).in("id", transactionIds);
  if (guardPostedTransactions) query = query.is("journal_id", null);
  const { data, error: updateError } = await query.select("id");
  if (updateError) throw updateError;
  const updatedIds = (data ?? []).map((row) => row.id as number);
  const updatedIdSet = new Set(updatedIds);

  const historyRows = previousRows
    .filter((previous) => (!guardPostedTransactions || updatedIdSet.has(previous.id)) && hasRealChange(previous))
    .map((previous) => ({
      company_id: companyId,
      transaction_id: previous.id,
      previous_status: previous.allocationStatus,
      new_status: previous.allocationStatus,
      is_manual_override: true,
      performed_by: performedBy,
      ...historyFields(previous),
    }));
  if (historyRows.length > 0) {
    const { error: historyError } = await supabase.from("ae_allocation_history").insert(historyRows);
    if (historyError) throw historyError;
  }

  return { updatedIds };
}

/** Pilot Review Round 1, Phase 7 — "If repeated allocations are
 * detected, prompt: would you like to create a Banking Rule?" Counts how
 * many OTHER transactions with this same beneficiary already carry this
 * same target (GL account, customer, or supplier) — queried against
 * current state on `ae_bank_transactions` itself (the same columns
 * `bulkAssignGl`/`bulkAssignCustomer`/`bulkAssignSupplier` write to),
 * not a separate learning model. */
export async function countBeneficiaryAllocations(
  companyId: string,
  beneficiary: string,
  target: { glAccount?: string; customerId?: number; supplierId?: number },
  excludeTransactionId: number,
): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("ae_bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("beneficiary", beneficiary)
    .neq("id", excludeTransactionId);
  if (target.glAccount) query = query.eq("suggested_gl_account", target.glAccount);
  else if (target.customerId !== undefined) query = query.eq("matched_customer_id", target.customerId);
  else if (target.supplierId !== undefined) query = query.eq("matched_supplier_id", target.supplierId);
  else return 0;

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Phase 29 — root-cause fix. This function (and `bulkAssignGl`/
 * `bulkAssignCustomer` below) is the write path behind BOTH the
 * bulk-action-bar's "Assign Supplier" button AND the inline grid's
 * `allocateRow`/Accept flow. It already correctly set
 * `is_manual_override: true`, but never set `allocation_status` or
 * `allocation_method` — meaning a transaction manually assigned (or an
 * AI/Rule suggestion accepted/overridden) kept whatever `allocation_status`
 * it already had (often still `'Unallocated'`, or `'Suggested'`/`'Allocated'`
 * with `allocation_method` permanently stuck at `'Future AI'`) forever in
 * the database — the badge and `needsAiAcceptAction` (which the grid's
 * OWN test fixtures already assume transitions to `allocation_method:
 * 'Manual'` once a human has confirmed a row — see
 * `transaction-grid.test.tsx`'s "false for a plain Allocated row with no
 * AI involvement") never actually resolved to that settled state. Now
 * sets both, using the SAME `'Manual'` literal value Find & Recode's
 * `bulkRecodeSupplier` below already established for the identical
 * semantic action ("a human just confirmed/changed this transaction's
 * target") — no new status vocabulary invented. */
export async function bulkAssignSupplier(companyId: string, transactionIds: number[], supplierId: number, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_supplier_id: supplierId, allocation_type: "S", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true },
    () => ({ allocation_reason: "Manually assigned supplier" }),
    performedBy,
    true,
    (previous) => hasSupplierAssignmentChanged(previous, supplierId),
  );
}

export async function bulkAssignGl(companyId: string, transactionIds: number[], glAccount: string, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { suggested_gl_account: glAccount, allocation_type: "G", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true },
    (previous) => ({ previous_gl_account: previous.suggestedGlAccount, new_gl_account: glAccount, allocation_reason: "Manually assigned GL account" }),
    performedBy,
    true,
    (previous) => hasGlAssignmentChanged(previous, glAccount),
  );
}

/** Phase 23A (Find & Recode) — a sibling of `bulkAssignGl` immediately
 * above, reusing the SAME `bulkUpdateWithAllocationHistory` core (never a
 * parallel write mechanism). Sets `allocation_method: 'Manual'` on the
 * transaction itself, not just in the history row — this is what makes
 * an "AI Classified"/"Rule Created" badge correctly stop showing once a
 * transaction has been deliberately recoded, satisfying "the recode
 * becomes authoritative... must not be overwritten" — plus a distinct,
 * honest `allocation_reason` so the audit trail (`ae_allocation_history`)
 * can tell a Find & Recode bulk action apart from the ordinary Transaction
 * Explorer "Assign GL" bulk-bar button, without a second audit table.
 *
 * Phase 29 — also sets `allocation_status: 'Allocated'`, and gets the
 * same no-op history guard as `bulkAssignGl` above (same root cause,
 * same fix: this function never set `allocation_status`, so a
 * Find-&-Recode'd row could keep showing a stale `'Suggested'`/
 * `'Unallocated'` badge forever even though it now has a real,
 * human-confirmed target). */
export async function bulkRecodeGlAccount(companyId: string, transactionIds: number[], glAccount: string, performedBy: string): Promise<{ updatedIds: number[] }> {
  return bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { suggested_gl_account: glAccount, allocation_type: "G", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true },
    (previous) => ({
      previous_gl_account: previous.suggestedGlAccount,
      new_gl_account: glAccount,
      allocation_method: "Manual",
      allocation_reason: "Find & Recode — bulk GL recode",
    }),
    performedBy,
    true,
    (previous) => hasGlAssignmentChanged(previous, glAccount),
  );
}

/** Phase 25G (Find & Recode) — the supplier-side sibling of
 * `bulkRecodeGlAccount` immediately above, reusing the SAME
 * `bulkUpdateWithAllocationHistory` core. `ae_allocation_history` has no
 * `previous_supplier_id`/`new_supplier_id` columns (confirmed by
 * inspection — it is GL/VAT-shaped only), so the before/after supplier is
 * recorded in `allocation_reason` text, the same field
 * `bulkAssignSupplier` already relies on for its own (much thinner)
 * "Manually assigned supplier" note — no migration, no second audit
 * table. Also sets `allocation_method: 'Manual'`, for the same reason
 * `bulkRecodeGlAccount` already sets it: a Find & Recode recode is
 * meant to become authoritative over whatever Rules/AI/manual-assign
 * previously set, not blend in as another ordinary assignment.
 *
 * Phase 29 — also sets `allocation_status: 'Allocated'` and the same
 * no-op history guard; see `bulkRecodeGlAccount`'s own comment above for
 * why. */
export async function bulkRecodeSupplier(companyId: string, transactionIds: number[], supplierId: number, supplierName: string, performedBy: string): Promise<{ updatedIds: number[] }> {
  return bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_supplier_id: supplierId, allocation_type: "S", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true },
    (previous) => ({
      allocation_method: "Manual",
      allocation_reason: `Find & Recode — bulk supplier recode: ${previous.matchedSupplierName ?? "Unassigned"} (#${previous.matchedSupplierId ?? "none"}) -> ${supplierName} (#${supplierId})`,
    }),
    performedBy,
    true,
    (previous) => hasSupplierAssignmentChanged(previous, supplierId),
  );
}

/** Phase 25G (Find & Recode) — the customer-side sibling. No
 * `matchedCustomerName` field exists on `BankTransactionRecord` (unlike
 * `matchedSupplierName`), so the previous customer is recorded by id
 * only in the reason text — still auditable (a reviewer can look the id
 * up), and adding a customer-name lookup here would turn a single
 * bulk UPDATE+INSERT into an extra query for a repository function that
 * is otherwise identical in shape to every other bulk* function in this
 * file.
 *
 * Phase 29 — also sets `allocation_status: 'Allocated'` and the same
 * no-op history guard as its GL/Supplier siblings above. */
export async function bulkRecodeCustomer(companyId: string, transactionIds: number[], customerId: number, customerName: string, performedBy: string): Promise<{ updatedIds: number[] }> {
  return bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_customer_id: customerId, allocation_type: "C", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true },
    (previous) => ({
      allocation_method: "Manual",
      allocation_reason: `Find & Recode — bulk customer recode: previous customer id ${previous.matchedCustomerId ?? "none"} -> ${customerName} (#${customerId})`,
    }),
    performedBy,
    true,
    (previous) => hasCustomerAssignmentChanged(previous, customerId),
  );
}

/** Phase 25G (Find & Recode) — the VAT-side sibling of
 * `bulkRecodeGlAccount`/`bulkRecodeSupplier`/`bulkRecodeCustomer` above,
 * reusing the SAME `bulkUpdateWithAllocationHistory` core. Unlike GL,
 * `ae_allocation_history` DOES already have `previous_vat_code`/
 * `new_vat_code` columns (the same ones `bulkAssignVat` below already
 * writes to) — no reason-text workaround needed here. Confirmed by
 * inspection before this was added: `suggested_vat_code` is informational
 * only (display/export/stats) and is never read by journal posting or
 * VAT Return computation (`computePeriodVat` reads GL account activity,
 * not this column) — a VAT recode carries no more risk than a GL recode,
 * and no less. */
export async function bulkRecodeVat(companyId: string, transactionIds: number[], vatCode: string, performedBy: string): Promise<{ updatedIds: number[] }> {
  return bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { suggested_vat_code: vatCode, allocation_method: "Manual", is_manual_override: true },
    (previous) => ({
      previous_vat_code: previous.suggestedVatCode,
      new_vat_code: vatCode,
      allocation_method: "Manual",
      allocation_reason: "Find & Recode — bulk VAT recode",
    }),
    performedBy,
    true,
    (previous) => hasVatRecodeChanged(previous, vatCode),
  );
}

/** Phase 29 — VAT alone is a secondary attribute, not "the allocation"
 * itself (an accountant can tweak just the VAT code on an
 * already-allocated row without that retroactively meaning the whole
 * row's GL/Supplier/Customer target became human-confirmed) — unlike
 * `bulkAssignGl`/`bulkAssignSupplier`/`bulkAssignCustomer` above, this
 * deliberately does NOT touch `allocation_status`/`allocation_method`.
 * Still gets the same no-op history guard.
 *
 * Phase 29A — the forensic review's own finding: this used to ALSO set
 * `is_manual_override: true` on `ae_bank_transactions` even though it
 * never touches `suggested_gl_account`/`matched_supplier_id`/
 * `matched_customer_id`. `company-historical-evidence.ts` (Phase 28)
 * reads that exact column as its "human-confirmed" signal for whichever
 * GL account the row currently carries — so tweaking ONLY the VAT code
 * on a still-AI-suggested, never-reviewed row was silently promoting
 * that row's UNCONFIRMED AI GL suggestion into Strong/Moderate
 * "human-confirmed" evidence for every future transaction matching the
 * same narration pattern, contradicting Phase 28/28B's own explicit
 * "AI-only history must never become human evidence" guarantee. Removed
 * here — `is_manual_override` on the transaction row now only ever
 * reflects a genuine GL/Supplier/Customer target confirmation. (The
 * `ae_allocation_history` row's own `is_manual_override: true`, set
 * unconditionally by `bulkUpdateWithAllocationHistory` above, is
 * unaffected and correctly unchanged — that column records "was this
 * particular audit entry a manual UI action," which a VAT assignment
 * genuinely is; it is a different question from whether the CURRENT
 * transaction's GL target is trustworthy evidence.) */
export async function bulkAssignVat(companyId: string, transactionIds: number[], vatCode: string, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { suggested_vat_code: vatCode },
    (previous) => ({ previous_vat_code: previous.suggestedVatCode, new_vat_code: vatCode, allocation_reason: "Manually assigned VAT treatment" }),
    performedBy,
    true,
    (previous) => hasVatAssignmentChanged(previous, vatCode),
  );
}

/** Phase 29A — same fix as `bulkAssignVat` immediately above and for the
 * identical reason: matching a Merchant is informational (feeds the
 * Merchant Intelligence panel and similar-past-classification lookups),
 * never "the allocation" itself — it must not silently promote an
 * unconfirmed AI/Rule GL suggestion into human-confirmed evidence. */
export async function bulkAssignMerchant(companyId: string, transactionIds: number[], merchantId: number, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_merchant_id: merchantId },
    () => ({ allocation_reason: "Manually assigned merchant" }),
    performedBy,
    true,
    (previous) => hasMerchantAssignmentChanged(previous, merchantId),
  );
}

export async function bulkAssignCustomer(companyId: string, transactionIds: number[], customerId: number, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_customer_id: customerId, allocation_type: "C", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true },
    () => ({ allocation_reason: "Manually assigned customer" }),
    performedBy,
    true,
    (previous) => hasCustomerAssignmentChanged(previous, customerId),
  );
}

export type AllocateRowFields = {
  /** Phase 31B — `null` means "no allocation in this commit" (a
   * description/notes/VAT-only fix on an Unallocated row). None of
   * `bulkAssignGl`/`bulkAssignSupplier`/`bulkAssignCustomer` run in that
   * case, and the final update writes `allocation_type: null` — always
   * safe, since the client only ever sends `null` here when the row's
   * own current Type is already null (see `AllocateRowInput`'s doc
   * comment in the service layer). */
  type: "G" | "C" | "S" | null;
  accountCode: string | null;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string | null;
  allocationNotes: string;
  /** Supplier Invoice Matching Override (migration 0095). `null` means
   * "unchanged, omit from the UPDATE" — the same convention `description`
   * uses — so an ordinary allocation commit never silently clears an
   * override the accountant set earlier. `true`/`false` is a deliberate
   * change. It lifts only the invoice-matching requirement; it never
   * creates an invoice, a bill or a match, and never classifies. */
  overrideSupplierInvoiceMatching?: boolean | null;
  /** Phase 31A — `null` means "unchanged, omit from the UPDATE entirely"
   * (never re-writes an identical description on a Type/Account/VAT/
   * Notes-only save). See `isDuplicateNaturalKey` below for the one real
   * consequence of this column being editable: it's part of
   * `ae_bank_transactions_natural_key` (migration 0004), the constraint
   * that makes re-importing the same bank statement idempotent. */
  description: string | null;
};

export type AllocateRowResult = { updatedIds: number[]; blockedIds: number[] };

/** Phase 31A — `description` is one of the seven columns in
 * `ae_bank_transactions_natural_key` (company_id, bank_account,
 * transaction_date, reference, debit, credit, description — migration
 * 0004), the unique constraint the import pipeline relies on to
 * recognise "this row was already imported" and skip re-inserting it.
 * Editing a description can, in principle, make an edited row collide
 * with another transaction that already shares the same
 * account/date/reference/amounts (rare, but not impossible — e.g. two
 * genuinely separate transactions on the same day for the same amount
 * with no reference, now given the identical cleaned-up description).
 * Same established pattern as `chart-of-accounts-service.ts`'s
 * `isDuplicateAccountCode` — a raw `23505` from Postgres is never
 * acceptable to surface directly to an accountant. */
export function isDuplicateNaturalKey(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  return code === "23505" && message.includes("ae_bank_transactions_natural_key");
}

/** Phase 31 — "Save Selected"/bulk-save requirement: a blocked write must
 * be reported, not silently swallowed. Pure and exported (no Supabase
 * involved) so the "which requested ids didn't come back" computation is
 * directly unit-testable, matching this file's own established convention
 * of extracting decision logic into small pure functions rather than only
 * proving it via integration. */
export function computeBlockedIds(requestedIds: number[], updatedRows: { id: number }[]): number[] {
  const updatedIdSet = new Set(updatedRows.map((row) => row.id));
  return requestedIds.filter((id) => !updatedIdSet.has(id));
}

/** Transaction Explorer Redesign, Phase 1 — the one write path behind the
 * new inline grid's per-row commit AND its "apply to selected" bulk
 * allocation (same function, `transactionIds` is `[id]` for the former).
 * Deliberately reuses the existing, already-audited
 * `bulkAssignGl`/`bulkAssignSupplier`/`bulkAssignCustomer`/`bulkAssignVat`
 * functions above rather than duplicating their allocation-history
 * writes — this only adds the one new direct update those don't cover
 * (`allocation_type`/`allocation_notes`, see migration 0062).
 *
 * Phase 31 forensic finding — this final update already carried the
 * correct `.is("journal_id", null)` guard, but nothing ever inspected
 * which of the requested ids the guard actually let through: a
 * transaction posted between page-load and Save silently kept whatever it
 * already had, while the caller still saw a plain success with no way to
 * tell the write never happened. `blockedIds` (derived from THIS query's
 * own `.select("id")`, not a separate read) closes that gap for every
 * caller — the single-row commit button, Accept, and the new bulk "Save
 * Selected" alike — without weakening or duplicating the existing guard. */
/** Phase 31A — pure and exported for the same reason `computeBlockedIds`
 * is: "an unchanged description is never unnecessarily written" (and, by
 * extension, never re-checked against the natural-key constraint for no
 * reason) is a real, testable decision, not just a Supabase call. */
export function buildAllocateRowFinalUpdate(
  input: Pick<AllocateRowFields, "type" | "allocationNotes" | "description" | "overrideSupplierInvoiceMatching">,
  performedBy?: string,
  now: () => string = () => new Date().toISOString(),
): Record<string, unknown> {
  const update: Record<string, unknown> = { allocation_type: input.type, allocation_notes: input.allocationNotes };
  if (input.description !== null) update.description = input.description;
  // Migration 0095 — `null` means "unchanged", so an ordinary allocation
  // commit never clears an override the accountant set earlier. Setting
  // one records who and when; clearing one removes that attribution
  // rather than leaving a stale name against a decision that no longer
  // stands.
  if (input.overrideSupplierInvoiceMatching !== null && input.overrideSupplierInvoiceMatching !== undefined) {
    update.override_supplier_invoice_matching = input.overrideSupplierInvoiceMatching;
    update.override_supplier_invoice_matching_by = input.overrideSupplierInvoiceMatching ? (performedBy ?? null) : null;
    update.override_supplier_invoice_matching_at = input.overrideSupplierInvoiceMatching ? now() : null;
  }
  return update;
}

export async function allocateRow(companyId: string, transactionIds: number[], input: AllocateRowFields, performedBy: string): Promise<AllocateRowResult> {
  const tasks: Promise<void>[] = [];
  if (input.type === "G" && input.accountCode) tasks.push(bulkAssignGl(companyId, transactionIds, input.accountCode, performedBy));
  if (input.type === "S" && input.supplierId !== null) tasks.push(bulkAssignSupplier(companyId, transactionIds, input.supplierId, performedBy));
  if (input.type === "C" && input.customerId !== null) tasks.push(bulkAssignCustomer(companyId, transactionIds, input.customerId, performedBy));
  if (input.vatCode) tasks.push(bulkAssignVat(companyId, transactionIds, input.vatCode, performedBy));
  await Promise.all(tasks);

  // Phase 29 — this direct update sits OUTSIDE `bulkUpdateWithAllocationHistory`,
  // so it previously had no posted-transaction guard of its own; it only
  // inherited protection transitively from whichever `bulkAssignX` call(s)
  // above happened to run for this request. Adding `.is("journal_id", null)`
  // directly here closes that gap for defense-in-depth, matching the Phase 27
  // guarantee every other write path in this file already enforces — and,
  // Phase 31A, now also protects `description`: the SAME guard blocks a
  // description change on a posted transaction exactly like every other
  // field this update touches, no special-casing needed.
  const supabase = await createClient();
  const finalUpdate = buildAllocateRowFinalUpdate(input, performedBy);
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .update(finalUpdate)
    .eq("company_id", companyId)
    .in("id", transactionIds)
    .is("journal_id", null)
    .select("id");
  // A raw `23505` (see `isDuplicateNaturalKey`) is left to propagate
  // as-is here — converting it to an accountant-facing message is the
  // SERVICE layer's job (`transaction-explorer-service.ts::allocateRow`),
  // matching the existing `chart-of-accounts-service.ts::isDuplicateAccountCode`
  // precedent: this repository only ever speaks Supabase, never `ValidationError`.
  if (error) throw error;
  const updatedRows = (data ?? []) as { id: number }[];
  return { updatedIds: updatedRows.map((row) => row.id), blockedIds: computeBlockedIds(transactionIds, updatedRows) };
}

export type RuleResolutionFields = Partial<{
  matchedMerchantId: number;
  matchedSupplierId: number;
  matchedCustomerId: number;
  suggestedGlAccount: string;
  suggestedVatCode: string;
  ruleId: number;
  allocationStatus: "Allocated" | "Suggested";
}>;

/** Applies the Rule Engine's resolved fields to one transaction — same
 * allocation-history trail as every manual bulk-assign action, but
 * `allocation_method: 'Rule Engine'`-equivalent is conveyed via
 * `rule_id` rather than `is_manual_override` (left false here, since
 * this is automatic, not a human override). */
/** Phase 25K — the WHERE clause now repeats the SAME "still safe to
 * automatically touch" condition `processTransaction`'s own in-memory
 * check (`transaction.journalId !== null`) was only ever a stale snapshot
 * of: `journal_id IS NULL` (never overwrite a posted transaction's
 * classification) AND `is_manual_override = false` (never let an
 * automatic Rule Engine pass silently overwrite a transaction a human
 * deliberately recoded via Find & Recode — the codebase's own documented
 * "the recode becomes authoritative" invariant, previously enforced
 * against AI classification's atomic claim but not against this write).
 * Returns `false` (rather than throwing) when the row no longer matches
 * — a genuine race loss (posted or manually recoded by another process
 * between this pass's read and this write) — so the caller can treat it
 * the same as "already posted, nothing to do" instead of corrupting the
 * transaction's classification or its audit trail.
 *
 * Phase 27 — Production Readiness Audit found this guard was still
 * missing the SAME "genuinely untouched" conditions `isEligibleForAiClassification`
 * (`@/server/ai/transaction-classification/types`) and
 * `fn_apply_ai_classification`'s own WHERE clause already require:
 * `rule_id`/`matched_supplier_id`/`matched_customer_id`/`matched_merchant_id`
 * all `IS NULL`. Without them, `RuleEngineRun`'s standing recovery-sweep
 * task — which re-scans EVERY unposted transaction on every pass via
 * `listUnprocessedTransactions` (no `allocation_status` filter there
 * either) — could silently reclassify a transaction a DIFFERENT rule, or
 * Supplier Reconciliation Matching, had already claimed.
 *
 * Phase 53 — Production Forensic Investigation (Phase 52) proved this
 * guard's ORIGINAL, stricter form (`allocation_status = 'Unallocated' AND
 * suggested_gl_account IS NULL`, unconditionally) created a permanent
 * lock: once the AI Classification Sweep — which self-paces as fast as
 * every 2 minutes, far faster than this task's fixed 60-minute cadence —
 * stamped its own unconfirmed guess on a transaction, NO Banking Rule
 * created afterwards could ever claim it, not on the next import, not on
 * any future recovery pass, ever. Required precedence is now: BANKING
 * RULE > UNCONFIRMED AI SUGGESTION > UNALLOCATED, while HUMAN CONFIRMED /
 * POSTED still beats everything automatic. `allocation_method = 'Future
 * AI'` (set only by `fn_apply_ai_classification`, which itself never
 * touches `matched_supplier_id`/`matched_customer_id`/`matched_merchant_id`
 * — confirmed by reading migration 0087) is the one reliable marker for
 * "this is only an unconfirmed AI guess, not a Rule/Matching-Engine
 * decision" — Supplier Reconciliation Matching's own automatic writes use
 * `allocation_method` values `'Matched Bill'`/`'Supplier Default'`, which
 * this relaxed condition deliberately does NOT match, so a Banking Rule
 * still cannot silently override a Matching Engine decision (unrelated
 * subsystem, out of scope for this precedence rule). The claim condition
 * is now: "completely untouched" (the original, unconditional shape) OR
 * "the only thing here is an unconfirmed AI suggestion" — either way,
 * still gated behind `rule_id`/`matched_*_id IS NULL` (never re-fight
 * another rule or a Matching Engine identification) and
 * `is_manual_override = false` + `journal_id IS NULL` (D — human-confirmed
 * and posted transactions stay untouchable, unchanged). This function
 * remains the ONLY automatic single-transaction write path
 * (`processTransaction`'s one caller) — deliberately separate from
 * `applyRuleActionsBatchOverridingAiSuggestions` below, which stays
 * exactly as Phase 51 shipped it (explicit-confirmation-gated, batched,
 * its own distinct allocation_reason wording) and is never called from
 * here. */
export async function applyRuleActions(companyId: string, transactionId: number, fields: RuleResolutionFields, matchedRuleName: string, performedBy: string, matchedRuleIds: number[] = []): Promise<boolean> {
  // Migration 0100 — the guard, the classification write, its allocation
  // history row and the rule-application rows are now ONE database call
  // (`fn_claim_bank_transaction_for_rule`), which also refuses Manual
  // Cashbook entries. Same fields, same G/S/C precedence, same
  // "Resolved by rule" history wording as the two PostgREST writes it
  // replaces; they can no longer be separated by a failure.
  if (Object.values(fields).every((value) => value === undefined)) return true;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_claim_bank_transaction_for_rule", {
    p_company_id: companyId,
    p_transaction_id: transactionId,
    p_claim: buildRuleClaim(fields, matchedRuleName, matchedRuleIds),
    p_performed_by: performedBy,
  });
  if (error) throw error;
  return data === true;
}

/** The claim `fn_claim_bank_transaction_for_rule` / `fn_post_rule_engine_journal`
 * take: only the fields the rule resolved (an absent key leaves that column
 * alone), plus the rule's name and every matched rule for the history. */
export function buildRuleClaim(fields: RuleResolutionFields, matchedRuleName: string, matchedRuleIds: number[], performedBy?: string): Record<string, unknown> {
  const claim: Record<string, unknown> = { ruleName: matchedRuleName, matchedRuleIds };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) claim[key] = value;
  }
  if (performedBy !== undefined) claim.performedBy = performedBy;
  return claim;
}

/** Phase 40, Live Defect 2 — production forensic finding: `applyRuleActions`
 * originally required a transaction to be COMPLETELY untouched
 * (`suggested_gl_account`/`rule_id`/every matched-* id all null) before
 * ANY rule could claim it. That created a permanent lock the AI
 * Classification Sweep could trigger (claiming a transaction before a
 * matching Banking Rule existed for it), which this function was
 * originally built to break, but only for one explicit, user-confirmed,
 * whole-rule sweep at a time.
 *
 * Phase 53 — `applyRuleActions` above no longer has that permanent-lock
 * problem: its guard now itself allows a Banking Rule to automatically
 * replace an unconfirmed AI suggestion (`allocation_method = 'Future AI'`),
 * on every ordinary pass (`runRuleEngine`, imports, the "Apply Rule" bulk
 * action) — see that function's own updated doc comment for the exact
 * precedence rule. This function remains useful for its own distinct
 * purpose: an EXPLICIT, user-confirmed, immediate, whole-rule sweep
 * (Set Rule → "Apply to Remaining" → Confirm) rather than waiting for the
 * next standing recovery-task pass — and it still is, and must remain,
 * the ONLY path gated behind that explicit confirmation UI. Never called
 * from `runRuleEngine`/`applyRulesToTransactions`.
 * "Already allocated" here means a HUMAN already confirmed some
 * allocation (`is_manual_override = true`) or the transaction is posted
 * (`journal_id IS NOT NULL`) — both still fully protected by the WHERE
 * clause below. An unconfirmed AI/prior-rule guess is exactly what a
 * deliberately-authored, more specific new rule is meant to supersede —
 * not a permanent lock a human's own rule can never open. Batched (one
 * UPDATE for every eligible id at once) since every matched transaction
 * for ONE rule resolves to the exact same fields — no per-row looping
 * needed, unlike `applyRuleActions`'s single-transaction shape. */
export async function applyRuleActionsBatchOverridingAiSuggestions(
  companyId: string,
  transactionIds: number[],
  fields: RuleResolutionFields,
  matchedRuleName: string,
  performedBy: string,
): Promise<{ updatedIds: number[] }> {
  if (transactionIds.length === 0) return { updatedIds: [] };
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (fields.matchedMerchantId !== undefined) update.matched_merchant_id = fields.matchedMerchantId;
  if (fields.matchedSupplierId !== undefined) update.matched_supplier_id = fields.matchedSupplierId;
  if (fields.matchedCustomerId !== undefined) update.matched_customer_id = fields.matchedCustomerId;
  if (fields.suggestedGlAccount !== undefined) update.suggested_gl_account = fields.suggestedGlAccount;
  if (fields.suggestedVatCode !== undefined) update.suggested_vat_code = fields.suggestedVatCode;
  if (fields.ruleId !== undefined) update.rule_id = fields.ruleId;
  if (fields.allocationStatus !== undefined) update.allocation_status = fields.allocationStatus;
  if (fields.matchedSupplierId !== undefined) update.allocation_type = "S";
  else if (fields.matchedCustomerId !== undefined) update.allocation_type = "C";
  else if (fields.suggestedGlAccount !== undefined) update.allocation_type = "G";
  if (Object.keys(update).length === 0) return { updatedIds: [] };

  const { data, error: updateError } = await supabase
    .from("ae_bank_transactions")
    .update(update)
    .eq("company_id", companyId)
    .in("id", transactionIds)
    .is("journal_id", null)
    .eq("is_manual_override", false)
    // Migration 0094 — this path deliberately overrides unconfirmed AI
    // suggestions company-wide, so it is exactly the path that must not
    // run over a transaction someone has pulled out for review. The
    // person applying the rule has not looked at these rows
    // individually; the person who placed the hold has.
    .eq("review_hold", false)
    .select("id");
  if (updateError) throw updateError;
  const updatedRows = (data ?? []) as { id: number }[];
  if (updatedRows.length === 0) return { updatedIds: [] };

  const { error: historyError } = await supabase.from("ae_allocation_history").insert(
    updatedRows.map((row) => ({
      company_id: companyId,
      transaction_id: row.id,
      new_status: fields.allocationStatus,
      is_manual_override: false,
      performed_by: performedBy,
      allocation_reason: `Resolved by rule "${matchedRuleName}" (retroactive apply, overriding a prior unconfirmed AI/Rule suggestion)`,
    })),
  );
  if (historyError) throw historyError;
  return { updatedIds: updatedRows.map((row) => row.id) };
}

export type AiClassificationFields = {
  suggestedGlAccount: string;
  /** 0-100, VYRON's own deterministic reading of the model's stated
   * certainty (see `confidenceLevelFor` in
   * `@/server/ai/transaction-classification/types`) — stored in the
   * SAME `confidence` column `ae_allocation_history` already has for
   * every other allocation decision, never a new column. */
  confidence: number;
  /** A concise, user-safe sentence — never raw chain-of-thought. Folded
   * into `allocation_reason` alongside the model name, the same free-text
   * field `applyRuleActions` already writes a human-readable reason
   * into. */
  explanation: string;
  modelUsed: string;
  /** Phase 26A — `'Allocated'` only for a genuinely High-confidence
   * (`confidenceLevelFor(confidence) === "High"`, VYRON's own
   * deterministic >=85 threshold, never the model's own opinion of what
   * "high" means) classification; `'Suggested'` otherwise — the caller
   * (`transaction-classification-service.ts::classifyOne`) decides this
   * BEFORE calling here, so this repository stays a pure write path with
   * no confidence policy of its own. Both values are already valid,
   * pre-existing entries in `ae_bank_transactions.allocation_status`'s
   * own CHECK constraint (migration 0002) — see `fn_apply_ai_classification`
   * (migration 0083) for why this required widening that RPC, not the
   * schema. */
  targetStatus: "Suggested" | "Allocated";
};

/** Phase 22A — AI Transaction Classification's write path. Deliberately
 * modeled on `applyRuleActions` immediately above: same partial-update
 * shape, same `ae_allocation_history` trail, same `is_manual_override:
 * false` (this is an automatic suggestion, not a human decision).
 *
 * `allocation_method: 'Future AI'` — the literal value already reserved
 * in `ae_bank_transactions`'s own CHECK constraint since migration 0002
 * (`supabase/migrations/0002_supplier_reconciliation.sql`) and in the
 * `AllocationMethod` union (`@/server/accounting/types.ts`), never
 * produced by any code until now. No migration was needed to add this
 * capability — the schema already anticipated it.
 *
 * `allocation_status: 'Suggested'` — the SAME status a GL-only Banking
 * Rule match already produces (`rule-processing-service.ts`), so every
 * existing "Suggested" affordance (the inline grid's amber treatment,
 * the Accept-suggestion combobox behavior) already works for an AI
 * suggestion with zero UI changes; `transaction-grid.tsx`'s badge
 * precedence additionally checks `allocationMethod === "Future AI"` to
 * show a distinct "AI Classified" badge ahead of the generic one. */
/** Overnight audit finding (see this repository's own change history) —
 * `classifyOne`'s eligibility check (`isEligibleForAiClassification`)
 * runs once, in memory, before the AI provider call; nothing previously
 * re-checked eligibility at write time. Two overlapping classification
 * runs for the same company (e.g. Phase 25E's automatic bank-sync
 * classification racing a user's manual "Classify with AI" on the same
 * freshly-imported, still-Unallocated transactions) could therefore both
 * pass eligibility, both call the AI, and both write — double-counting
 * `ai_requests` usage and inserting two `ae_allocation_history` rows for
 * one transaction. The UPDATE below now repeats
 * `isEligibleForAiClassification`'s own conditions as WHERE clauses, so
 * only the process that gets there first can actually apply — the loser
 * updates zero rows and throws, which `classifyOne`'s existing
 * `try/catch` already collapses to `"failed"` (no usage recorded, no
 * history written) with no change needed to any caller's signature. */
/** Phase 25I — the UPDATE and the `ae_allocation_history` INSERT used to
 * be two separate, non-transactional calls: a failure on the INSERT
 * alone left the transaction genuinely reclassified with no audit trail
 * and no usage recorded, while reporting "failed" to the caller (and
 * permanently excluding the transaction from a future retry, since the
 * UPDATE's own WHERE guard requires `allocation_status = 'Unallocated'`).
 * `fn_apply_ai_classification` (migration 0081) makes both writes atomic
 * — same conditional-claim WHERE clause as before, unchanged behavior
 * for the concurrent-classification race this function was originally
 * hardened against, just no longer able to half-apply. */
export async function applyAiClassification(companyId: string, transactionId: number, fields: AiClassificationFields, performedBy: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_apply_ai_classification", {
    p_company_id: companyId,
    p_transaction_id: transactionId,
    p_suggested_gl_account: fields.suggestedGlAccount,
    p_confidence: fields.confidence,
    p_explanation: fields.explanation,
    p_model_used: fields.modelUsed,
    p_performed_by: performedBy,
    p_target_status: fields.targetStatus,
  });
  if (error) throw error;
  // Untyped RPC result — same convention as `posting-repository.ts`'s
  // `fn_post_approved_journals` call.
  const result = data as unknown as { claimed: boolean };
  if (!result.claimed) {
    throw new Error(`Transaction ${transactionId} is no longer eligible for AI classification — it was allocated by another process first.`);
  }
}

// Migration 0100 — `markTransactionPosted` (a stand-alone
// `journal_id`/`posted_flag` stamp written AFTER the journal had already
// been posted) was removed. Posting and linking are now one database call:
// `posting-repository.ts::postRuleEngineJournalAtomic`, and a missing link
// is restored only by `recoverRuleEngineJournalLink`.

export type DeleteTransactionsResult = { deletedIds: number[]; blockedIds: number[] };

/** Phase 39 — Delete Transaction. The `.is("journal_id", null)` guard is
 * the SAME posted-transaction protection every other write path in this
 * file already enforces (`bulkUpdateWithAllocationHistory`, `allocateRow`)
 * — a transaction with a journal already applies its own referential
 * protection (`ae_bank_transactions_journal_id_fkey ... on delete set
 * null`), but this guard exists so posted history is never silently
 * unlinked by a delete either; `computeBlockedIds` (already used by
 * `allocateRow`) reports exactly which requested ids the guard blocked,
 * rather than a coarse all-or-nothing failure. Every other dependent —
 * `ae_match_history`/`ae_allocation_history`/`ae_transaction_review_history`/
 * `banking_rule_applications`/`banking_exceptions`/`bank_transaction_splits`
 * — cascades automatically via schema-level `on delete cascade` FKs
 * (confirmed by direct migration audit before this was written), the
 * same mechanism `deleteImport`'s own bulk delete already relies on.
 * `ae_work_items` has no such FK (a live work-queue row, not an audit
 * record — an orphaned one is a real bug, not a harmless trace), so it's
 * explicitly cleaned up here, scoped to only the ids actually deleted. */
export async function deleteTransactions(companyId: string, transactionIds: number[]): Promise<DeleteTransactionsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .delete()
    .eq("company_id", companyId)
    .in("id", transactionIds)
    .is("journal_id", null)
    .select("id");
  if (error) throw error;
  const deletedRows = (data ?? []) as { id: number }[];
  const deletedIds = deletedRows.map((row) => row.id);

  if (deletedIds.length > 0) {
    const { error: workItemsError } = await supabase
      .from("ae_work_items")
      .delete()
      .eq("company_id", companyId)
      .eq("source_module", "BankTransaction")
      .in("source_record_id", deletedIds);
    if (workItemsError) throw workItemsError;
  }

  return { deletedIds, blockedIds: computeBlockedIds(transactionIds, deletedRows) };
}

export type ReviewHoldResult = { changedIds: number[]; changedCount: number };

/**
 * Places or releases a human-review hold — migration 0094's
 * `fn_set_review_hold`, the only write path for these columns.
 *
 * A hold is what makes "a person is dealing with this" a fact the
 * database can enforce, rather than an intention held only in someone's
 * head while an automation classifies underneath them. Releasing is the
 * same call with `hold: false`: deliberate, attributed, and never done
 * implicitly to let an automatic classifier succeed.
 */
export async function setReviewHold(
  companyId: string,
  transactionIds: number[],
  hold: boolean,
  reason: string,
  performedBy: string,
): Promise<ReviewHoldResult> {
  if (transactionIds.length === 0) return { changedIds: [], changedCount: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_set_review_hold", {
    p_company_id: companyId,
    p_transaction_ids: transactionIds,
    p_hold: hold,
    p_reason: reason,
    p_performed_by: performedBy,
  });
  if (error) throw error;
  // Untyped RPC result — see `gl-repository.ts::getTrialBalanceRows`'s own
  // note on why this is cast directly rather than `.returns<T>()`.
  const result = data as unknown as ReviewHoldResult;
  return { changedIds: result.changedIds ?? [], changedCount: result.changedCount ?? 0 };
}
