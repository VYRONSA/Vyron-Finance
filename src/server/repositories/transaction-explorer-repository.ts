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
} from "@/server/accounting/types";

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
  if (filters.statuses && filters.statuses.length > 0) query = query.in("allocation_status", filters.statuses);
  if (filters.bankAccountId !== null) query = query.eq("bank_account_id", filters.bankAccountId);
  if (filters.importBatch) query = query.eq("import_batch", filters.importBatch);
  if (filters.duplicateOnly) query = query.eq("required_action", REQUIRED_ACTION_DUPLICATE_PAYMENT);
  if (filters.unknownSupplierOnly) query = query.is("matched_supplier_id", null);

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

/** Every transaction the Rule Engine hasn't yet resolved to a journal —
 * the pipeline's own worklist. */
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

export async function listMatchHistory(transactionId: number): Promise<MatchHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_match_history")
    .select("*")
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true })
    .returns<MatchHistoryRow[]>();
  if (error) throw error;
  return data.map(matchHistoryFromRow);
}

export async function listAllocationHistory(transactionId: number): Promise<AllocationHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_allocation_history")
    .select("*")
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true })
    .returns<AllocationHistoryRow[]>();
  if (error) throw error;
  return data.map(allocationHistoryFromRow);
}

export async function listReviewHistory(transactionId: number): Promise<ReviewHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_transaction_review_history")
    .select("*")
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

async function bulkUpdateWithAllocationHistory(
  companyId: string,
  transactionIds: number[],
  update: Record<string, unknown>,
  historyFields: (previous: BankTransactionRecord) => Record<string, unknown>,
  performedBy: string,
): Promise<void> {
  const supabase = await createClient();
  const previousRows = await getTransactionsByIds(companyId, transactionIds);

  const { error: updateError } = await supabase.from("ae_bank_transactions").update(update).eq("company_id", companyId).in("id", transactionIds);
  if (updateError) throw updateError;

  const historyRows = previousRows.map((previous) => ({
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

export async function bulkAssignSupplier(companyId: string, transactionIds: number[], supplierId: number, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_supplier_id: supplierId, is_manual_override: true },
    () => ({ allocation_reason: "Manually assigned supplier" }),
    performedBy,
  );
}

export async function bulkAssignGl(companyId: string, transactionIds: number[], glAccount: string, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { suggested_gl_account: glAccount, is_manual_override: true },
    (previous) => ({ previous_gl_account: previous.suggestedGlAccount, new_gl_account: glAccount, allocation_reason: "Manually assigned GL account" }),
    performedBy,
  );
}

export async function bulkAssignVat(companyId: string, transactionIds: number[], vatCode: string, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { suggested_vat_code: vatCode, is_manual_override: true },
    (previous) => ({ previous_vat_code: previous.suggestedVatCode, new_vat_code: vatCode, allocation_reason: "Manually assigned VAT treatment" }),
    performedBy,
  );
}

export async function bulkAssignMerchant(companyId: string, transactionIds: number[], merchantId: number, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_merchant_id: merchantId, is_manual_override: true },
    () => ({ allocation_reason: "Manually assigned merchant" }),
    performedBy,
  );
}

export async function bulkAssignCustomer(companyId: string, transactionIds: number[], customerId: number, performedBy: string): Promise<void> {
  await bulkUpdateWithAllocationHistory(
    companyId,
    transactionIds,
    { matched_customer_id: customerId, is_manual_override: true },
    () => ({ allocation_reason: "Manually assigned customer" }),
    performedBy,
  );
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
export async function applyRuleActions(companyId: string, transactionId: number, fields: RuleResolutionFields, matchedRuleName: string, performedBy: string): Promise<void> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (fields.matchedMerchantId !== undefined) update.matched_merchant_id = fields.matchedMerchantId;
  if (fields.matchedSupplierId !== undefined) update.matched_supplier_id = fields.matchedSupplierId;
  if (fields.matchedCustomerId !== undefined) update.matched_customer_id = fields.matchedCustomerId;
  if (fields.suggestedGlAccount !== undefined) update.suggested_gl_account = fields.suggestedGlAccount;
  if (fields.suggestedVatCode !== undefined) update.suggested_vat_code = fields.suggestedVatCode;
  if (fields.ruleId !== undefined) update.rule_id = fields.ruleId;
  if (fields.allocationStatus !== undefined) update.allocation_status = fields.allocationStatus;
  if (Object.keys(update).length === 0) return;

  const { error: updateError } = await supabase.from("ae_bank_transactions").update(update).eq("company_id", companyId).eq("id", transactionId);
  if (updateError) throw updateError;

  // Pilot Review Round 1 — LIVE DEFECT found while verifying Phase 6's
  // scan-and-apply flow, but pre-existing in already-shipped code: this
  // insert never set `new_status`, a NOT NULL column on
  // `ae_allocation_history` — every successful automatic rule match
  // (via "Apply Rule," "Run Rule Engine Now," or this round's new scan-
  // and-apply) has always thrown here. Masked previously because prior
  // manual testing only ever exercised rules against transactions that
  // already had a matched supplier from the separate Matching Engine
  // (a different, working code path) — a genuinely new company's
  // imported transactions, resolved by a GL-only rule with no
  // supplier/customer match, hit this every time.
  const { error: historyError } = await supabase.from("ae_allocation_history").insert({
    company_id: companyId,
    transaction_id: transactionId,
    new_status: fields.allocationStatus,
    is_manual_override: false,
    performed_by: performedBy,
    allocation_reason: `Resolved by rule "${matchedRuleName}"`,
  });
  if (historyError) throw historyError;
}

export async function markTransactionPosted(companyId: string, transactionId: number, journalId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ae_bank_transactions")
    .update({ journal_id: journalId, posted_flag: true })
    .eq("company_id", companyId)
    .eq("id", transactionId);
  if (error) throw error;
}
