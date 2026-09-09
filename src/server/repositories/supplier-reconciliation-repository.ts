/**
 * Repository layer for Supplier Reconciliation — the only layer allowed
 * to speak Supabase, per the PRB's mandatory API separation (Browser ->
 * API Route -> Application Service -> Repository -> Supabase). Row Level
 * Security (see supabase/migrations/0002_supplier_reconciliation.sql)
 * does the actual company-isolation enforcement; every query here still
 * filters by company_id explicitly so intent is never left to RLS alone.
 */

import { createClient } from "@/lib/supabase/server";
import {
  bankTransactionFromRow,
  billFromRow,
  supplierFromRow,
  allocationResultToUpdate,
  matchResultToUpdate,
  matchResultEnrichmentUpdate,
  hasMatchResultChanged,
  hasAllocationResultChanged,
  type BankTransactionRow,
  type ImportedBillRow,
  type SupplierRow,
} from "@/server/accounting/mappers";
import type { AllocationResult, BankTransactionRecord, ImportedBill, MatchResult, Supplier } from "@/server/accounting/types";

/** Phase 29B — fetches current state for the no-op-history check and
 * for nothing else (the actual overwrite protection below is enforced
 * entirely at the UPDATE's own WHERE clause, never by an app-level
 * "read, decide, write" sequence — a stale read here can only cause an
 * unnecessary write attempt, never an unsafe one). Scoped to this file
 * (rather than importing `transaction-explorer-repository.ts`'s own
 * `getTransactionsByIds`) per this repository's own documented "only
 * layer allowed to speak Supabase for this module" boundary. */
async function getBankTransactionsByIds(companyId: string, ids: number[]): Promise<Map<number, BankTransactionRecord>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId).in("id", ids).returns<BankTransactionRow[]>();
  if (error) throw error;
  return new Map(data.map((row) => [row.id, bankTransactionFromRow(row)]));
}

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listSuppliers(companyId: string): Promise<Supplier[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_suppliers")
    .select("*")
    .eq("company_id", companyId)
    .order("name")
    .limit(LIST_CAP)
    .returns<SupplierRow[]>();
  if (error) throw error;
  return data.map(supplierFromRow);
}

export async function getSupplier(companyId: string, supplierId: number): Promise<Supplier | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_suppliers")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", supplierId)
    .maybeSingle<SupplierRow>();
  if (error) throw error;
  return data ? supplierFromRow(data) : null;
}

/**
 * Exact match (case-insensitive) against the primary name OR any
 * alternative name — ported from `SupplierService.find_by_name`. Loads
 * every supplier for the company rather than filtering in SQL, since
 * `alternative_names` is an array column and company supplier lists stay
 * small (hundreds, not millions).
 */
export async function findSupplierByName(companyId: string, name: string): Promise<Supplier | null> {
  const normalized = name.trim().toLowerCase();
  const suppliers = await listSuppliers(companyId);
  return (
    suppliers.find(
      (s) => s.name.trim().toLowerCase() === normalized || s.alternativeNames.some((a) => a.trim().toLowerCase() === normalized),
    ) ?? null
  );
}

/** Finding #037 — suppliers had no uniqueness constraint on
 * `supplier_code` at all (unlike `customers.customer_code`, which has a
 * real DB unique constraint). A blank code is never a collision — many
 * suppliers are created without one and get it assigned later. */
export async function findSupplierByCode(companyId: string, supplierCode: string, excludeSupplierId?: number): Promise<Supplier | null> {
  const trimmed = supplierCode.trim();
  if (!trimmed) return null;
  const suppliers = await listSuppliers(companyId);
  return suppliers.find((s) => s.supplierCode.trim() === trimmed && s.id !== excludeSupplierId) ?? null;
}

export async function createSupplierByName(companyId: string, name: string): Promise<Supplier> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_suppliers")
    .insert({ company_id: companyId, name })
    .select("*")
    .single<SupplierRow>();
  if (error) throw error;
  return supplierFromRow(data);
}

export async function listAllBills(companyId: string): Promise<ImportedBill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select("*")
    .eq("company_id", companyId)
    .order("invoice_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<ImportedBillRow[]>();
  if (error) throw error;
  return data.map(billFromRow);
}

export async function countOpenWorkItems(companyId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ae_work_items")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["New", "In Review"]);
  if (error) throw error;
  return count ?? 0;
}

// Finding #155 — Generate Reports previously always ran against 100% of
// the company's open bills/bank transactions with no way to limit scope.
// Both filters are optional and additive to the existing query, so an
// unscoped run (no filters passed) behaves exactly as before.
export type SupplierReconciliationScope = { dateFrom?: string; dateTo?: string; supplierId?: number };

export async function listOpenBills(companyId: string, scope: SupplierReconciliationScope = {}): Promise<ImportedBill[]> {
  const supabase = await createClient();
  let query = supabase.from("ae_imported_bills").select("*").eq("company_id", companyId).gt("outstanding", 0);
  if (scope.dateFrom) query = query.gte("invoice_date", scope.dateFrom);
  if (scope.dateTo) query = query.lte("invoice_date", scope.dateTo);
  if (scope.supplierId) query = query.eq("supplier_id", scope.supplierId);
  const { data, error } = await query.order("invoice_date", { ascending: false }).limit(10_000).returns<ImportedBillRow[]>();
  if (error) throw error;
  return data.map(billFromRow);
}

// Deliberately does NOT filter by `scope.supplierId` — an unmatched
// transaction has no `matched_supplier_id` yet (that's the whole point
// of running matching), so filtering transactions by supplier before
// matching would exclude exactly the rows a supplier-scoped run needs to
// find. Supplier-scoping instead narrows `listOpenBills` (bills DO carry
// `supplier_id` directly), so the Matching Engine can only find matches
// within that supplier's bills regardless of which transactions it sees.
export async function listBankTransactions(companyId: string, scope: Pick<SupplierReconciliationScope, "dateFrom" | "dateTo"> = {}): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  let query = supabase.from("ae_bank_transactions").select("*").eq("company_id", companyId);
  if (scope.dateFrom) query = query.gte("transaction_date", scope.dateFrom);
  if (scope.dateTo) query = query.lte("transaction_date", scope.dateTo);
  const { data, error } = await query.order("transaction_date", { ascending: false }).limit(10_000).returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

/** Phase 25K — `.is("journal_id", null)` added to the UPDATE's own WHERE
 * clause: re-running "Generate Supplier Allocation Reports" against a
 * transaction that's since been posted previously had NO protection at
 * all — not even a service-layer check.
 *
 * Phase 29B — the forensic review's own finding: this had NO protection
 * whatsoever against overwriting a transaction another engine had
 * already genuinely decided (manually allocated, an accepted/automatic
 * AI allocation, or a Banking Rule match) — `evaluateBatch` evaluates
 * EVERY debit transaction in scope with no `allocation_status` filter,
 * so re-running Matching against a company could silently clobber
 * `allocation_status`/`matched_supplier_id` on a row another workflow
 * already owned. Now a two-attempt, WHERE-clause-guarded write (never an
 * app-level "read, decide, write" — the WHERE clause itself is the
 * atomic, race-safe guard):
 *
 *   1. FULL update (`matchResultToUpdate`) — succeeds only when the
 *      transaction is NOT accounting-protected (`is_manual_override =
 *      false AND rule_id IS NULL AND allocation_method` is null or one
 *      of Supplier Reconciliation's own values — see
 *      `isSupplierReconAccountingProtected`, the single source of truth
 *      this WHERE clause mirrors). Identical behavior to before for
 *      every transaction Supplier Reconciliation already legitimately
 *      owns or a genuinely untouched transaction.
 *   2. If the full update affects 0 rows (protected, posted, or
 *      cross-company) AND a real supplier was identified, a NARROWER
 *      enrichment-only update (`matchResultEnrichmentUpdate`) — writes
 *      ONLY the "who is this" identification fields, guarded by its own
 *      independent `matched_supplier_id IS NULL` condition, so it can
 *      enrich "GL = 5000, Supplier = NULL" without ever overwriting the
 *      GL decision or an already-identified supplier (human or prior
 *      run). This is the Phase 29B Section 3 requirement: legitimate
 *      supplier identification must still be possible on an
 *      accounting-protected row, without touching its accounting state.
 *
 * A transaction excluded by both guards is left untouched (no history
 * row either). No-op detection (`hasMatchResultChanged`) skips the
 * write AND the history insert entirely when nothing would actually
 * change, so re-running Matching twice never creates duplicate history. */
export async function applyMatchResults(companyId: string, results: MatchResult[]): Promise<void> {
  const supabase = await createClient();
  const previous = await getBankTransactionsByIds(companyId, results.map((r) => r.bankTransactionId));

  for (const result of results) {
    const prev = previous.get(result.bankTransactionId);
    if (prev && !hasMatchResultChanged(prev, result)) continue;

    const { data, error } = await supabase
      .from("ae_bank_transactions")
      .update(matchResultToUpdate(result))
      .eq("id", result.bankTransactionId)
      .eq("company_id", companyId)
      .is("journal_id", null)
      .eq("is_manual_override", false)
      .is("rule_id", null)
      .or('allocation_method.is.null,allocation_method.in.("Matched Bill","Supplier Default")')
      .select("id");
    if (error) throw error;

    if (data && data.length > 0) {
      const { error: historyError } = await supabase.from("ae_match_history").insert({
        company_id: companyId,
        transaction_id: result.bankTransactionId,
        new_status: result.status,
        confidence: result.confidence,
        rules_triggered: result.rulesTriggered,
        reason: result.reason,
      });
      if (historyError) throw historyError;
      continue;
    }

    // Full update refused (accounting-protected, posted, or nonexistent
    // row) — only a real supplier identification is worth a narrower
    // enrichment attempt.
    if (result.matchedSupplierId === null) continue;

    const { data: enrichData, error: enrichError } = await supabase
      .from("ae_bank_transactions")
      .update(matchResultEnrichmentUpdate(result))
      .eq("id", result.bankTransactionId)
      .eq("company_id", companyId)
      .is("journal_id", null)
      .is("matched_supplier_id", null)
      .select("id, allocation_status");
    if (enrichError) throw enrichError;
    if (!enrichData || enrichData.length === 0) continue;

    const { error: enrichHistoryError } = await supabase.from("ae_match_history").insert({
      company_id: companyId,
      transaction_id: result.bankTransactionId,
      new_status: enrichData[0].allocation_status, // unchanged by this write — recorded honestly, not "Matched"/"Suggested"
      confidence: result.confidence,
      rules_triggered: result.rulesTriggered,
      reason: `${result.reason} (supplier identification only — an existing accounting allocation on this transaction was preserved)`,
    });
    if (enrichHistoryError) throw enrichHistoryError;
  }
}

/** Phase 25K — same `journal_id IS NULL` write-layer protection as
 * `applyMatchResults` above.
 *
 * Phase 29B — same accounting-protection guard as `applyMatchResults`'s
 * FULL update (see that function's own comment for the exact
 * `is_manual_override`/`rule_id`/`allocation_method` conditions and why
 * they're expressed at the WHERE-clause level, never app-side). No
 * "enrichment-only" variant here — every field `allocationResultToUpdate`
 * writes (`allocation_status`/`suggested_gl_account`/`suggested_vat_code`/
 * `allocation_method`/`allocation_type`/`required_action`) IS an
 * accounting decision, so a protected row is simply left untouched
 * entirely, never partially written. Also gets the same
 * `hasAllocationResultChanged` no-op guard. */
export async function applyAllocationResults(companyId: string, results: AllocationResult[]): Promise<void> {
  const supabase = await createClient();
  const previous = await getBankTransactionsByIds(companyId, results.map((r) => r.bankTransactionId));

  for (const result of results) {
    const prev = previous.get(result.bankTransactionId);
    if (prev && !hasAllocationResultChanged(prev, result)) continue;

    const { data, error } = await supabase
      .from("ae_bank_transactions")
      .update(allocationResultToUpdate(result))
      .eq("id", result.bankTransactionId)
      .eq("company_id", companyId)
      .is("journal_id", null)
      .eq("is_manual_override", false)
      .is("rule_id", null)
      .or('allocation_method.is.null,allocation_method.in.("Matched Bill","Supplier Default")')
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) continue;

    const { error: historyError } = await supabase.from("ae_allocation_history").insert({
      company_id: companyId,
      transaction_id: result.bankTransactionId,
      new_status: result.status,
      new_gl_account: result.glAccount,
      new_vat_code: result.vatCode,
      confidence: result.confidence,
      allocation_method: result.allocationMethod ?? "",
      allocation_reason: result.allocationReason,
    });
    if (historyError) throw historyError;
  }
}
