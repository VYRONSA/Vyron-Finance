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
  type BankTransactionRow,
  type ImportedBillRow,
  type SupplierRow,
} from "@/server/accounting/mappers";
import type { AllocationResult, BankTransactionRecord, ImportedBill, MatchResult, Supplier } from "@/server/accounting/types";

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

export async function listOpenBills(companyId: string): Promise<ImportedBill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select("*")
    .eq("company_id", companyId)
    .gt("outstanding", 0)
    .order("invoice_date", { ascending: false })
    .limit(10_000)
    .returns<ImportedBillRow[]>();
  if (error) throw error;
  return data.map(billFromRow);
}

export async function listBankTransactions(companyId: string): Promise<BankTransactionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .select("*")
    .eq("company_id", companyId)
    .order("transaction_date", { ascending: false })
    .limit(10_000)
    .returns<BankTransactionRow[]>();
  if (error) throw error;
  return data.map(bankTransactionFromRow);
}

export async function applyMatchResults(companyId: string, results: MatchResult[]): Promise<void> {
  const supabase = await createClient();
  for (const result of results) {
    const { error } = await supabase
      .from("ae_bank_transactions")
      .update(matchResultToUpdate(result))
      .eq("id", result.bankTransactionId)
      .eq("company_id", companyId);
    if (error) throw error;

    const { error: historyError } = await supabase.from("ae_match_history").insert({
      company_id: companyId,
      transaction_id: result.bankTransactionId,
      new_status: result.status,
      confidence: result.confidence,
      rules_triggered: result.rulesTriggered,
      reason: result.reason,
    });
    if (historyError) throw historyError;
  }
}

export async function applyAllocationResults(companyId: string, results: AllocationResult[]): Promise<void> {
  const supabase = await createClient();
  for (const result of results) {
    const { error } = await supabase
      .from("ae_bank_transactions")
      .update(allocationResultToUpdate(result))
      .eq("id", result.bankTransactionId)
      .eq("company_id", companyId);
    if (error) throw error;

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
