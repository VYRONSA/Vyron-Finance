/**
 * SD-3D — data access for supplier-statement reconciliation.
 *
 * READS of accounting data are SELECT-only, for ONE company and ONE supplier,
 * through the existing domain mappers — so the engine sees bills, payments,
 * bank transactions and opening balances exactly as the supplier ledger
 * (`report-centre/party-ledger.ts`) does. Nothing here writes to any
 * accounting table. The only writes are the reconciliation run and its
 * items (immutable, service role, after the request's permission check) and
 * the statement's status.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { bankTransactionFromRow, billFromRow, type BankTransactionRow, type ImportedBillRow } from "@/server/accounting/mappers";
import { openingBalanceEntryFromRow, type OpeningBalanceEntryRow } from "@/server/opening-balances/mappers";
import { supplierPaymentFromRow, type SupplierPaymentRow } from "@/server/purchasing/mappers";
import type { BankTransactionRecord, ImportedBill } from "@/server/accounting/types";
import type { OpeningBalanceEntry } from "@/server/opening-balances/types";
import type { SupplierPayment } from "@/server/purchasing/types";

const CAP = 20_000;

function systemClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supplier statement reconciliation is not configured (SUPABASE_SERVICE_ROLE_KEY is missing).");
  }
  return createAdminClient();
}

export type SupplierSources = {
  bills: ImportedBill[];
  payments: SupplierPayment[];
  bankTransactions: BankTransactionRecord[];
  openingBalances: OpeningBalanceEntry[];
};

/** Everything that can move this supplier's ledger — read only. */
export async function loadSupplierSources(companyId: string, supplierId: number): Promise<SupplierSources> {
  const client = systemClient();
  const [bills, payments, bank, openings] = await Promise.all([
    client.from("ae_imported_bills").select("*").eq("company_id", companyId).eq("supplier_id", supplierId).order("id").limit(CAP).returns<ImportedBillRow[]>(),
    client.from("supplier_payments").select("*").eq("company_id", companyId).eq("supplier_id", supplierId).order("id").limit(CAP).returns<SupplierPaymentRow[]>(),
    client.from("ae_bank_transactions").select("*").eq("company_id", companyId).eq("matched_supplier_id", supplierId).order("id").limit(CAP).returns<BankTransactionRow[]>(),
    client.from("opening_balance_entries").select("*").eq("company_id", companyId).eq("supplier_id", supplierId).order("id").limit(CAP).returns<OpeningBalanceEntryRow[]>(),
  ]);
  for (const r of [bills, payments, bank, openings]) if (r.error) throw r.error;
  return {
    bills: bills.data!.map(billFromRow),
    payments: payments.data!.map(supplierPaymentFromRow),
    bankTransactions: bank.data!.map(bankTransactionFromRow),
    openingBalances: openings.data!.map(openingBalanceEntryFromRow),
  };
}

export type CaptureRef = {
  id: number;
  status: string;
  supplier_id: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number | string | null;
  document_type: string | null;
  bill_id: number | null;
};

/** This supplier's captures (to tell "captured — draft" apart), read only. */
export async function loadSupplierCaptures(companyId: string, supplierId: number): Promise<CaptureRef[]> {
  const { data, error } = await systemClient()
    .from("supplier_invoice_captures")
    .select("id, status, supplier_id, invoice_number, invoice_date, total, document_type, bill_id")
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .order("id")
    .limit(CAP)
    .returns<CaptureRef[]>();
  if (error) throw error;
  return data;
}

/** Bills (any supplier) that were created by converting a capture. */
export async function loadCaptureBillIds(companyId: string, billIds: number[]): Promise<Set<number>> {
  if (billIds.length === 0) return new Set();
  const { data, error } = await systemClient()
    .from("supplier_invoice_captures")
    .select("bill_id")
    .eq("company_id", companyId)
    .in("bill_id", billIds.slice(0, 1000))
    .returns<{ bill_id: number }[]>();
  if (error) throw error;
  return new Set(data.map((r) => r.bill_id));
}

export type ResolutionRow = {
  id: number;
  statement_id: number;
  action: "manual-link" | "explained" | "revoke";
  statement_line_id: number | null;
  precisia_ref_type: string | null;
  precisia_ref_id: number | null;
  revokes_resolution_id: number | null;
  reason: string;
  performed_by: string;
  created_at: string;
};

export async function listResolutionsAsSystem(companyId: string, statementId: number): Promise<ResolutionRow[]> {
  const { data, error } = await systemClient()
    .from("supplier_statement_resolutions")
    .select("*")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("id")
    .returns<ResolutionRow[]>();
  if (error) throw error;
  return data;
}

export async function listResolutions(companyId: string, statementId: number): Promise<ResolutionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statement_resolutions")
    .select("*")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("id")
    .returns<ResolutionRow[]>();
  if (error) throw error;
  return data;
}

/** A reviewer's decision; the database takes the actor from the session and
 * checks permission, state and that every reference belongs to this
 * statement's confirmed supplier in this company. */
export async function recordResolution(input: {
  companyId: string;
  statementId: number;
  action: "manual-link" | "explained" | "revoke";
  statementLineId: number | null;
  refType: string | null;
  refId: number | null;
  revokesResolutionId: number | null;
  reason: string;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_supplier_statement_record_resolution", {
    p_company_id: input.companyId,
    p_statement_id: input.statementId,
    p_action: input.action,
    p_statement_line_id: input.statementLineId,
    p_precisia_ref_type: input.refType,
    p_precisia_ref_id: input.refId,
    p_revokes_resolution_id: input.revokesResolutionId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data as number;
}

export type RunRow = {
  id: number;
  company_id: string;
  statement_id: number;
  run_number: number;
  engine_version: string;
  basis: string;
  supplier_id: number;
  as_at_date: string;
  window_from: string;
  window_to: string;
  statement_opening: number | string;
  statement_closing: number | string;
  precisia_balance_before_window: number | string;
  precisia_balance_at: number | string;
  difference: number | string;
  explained_amount: number | string;
  explained_by_reviewer_amount: number | string;
  unexplained_amount: number | string;
  /** Per category {count, amount}; plus `__residual`, and for SD-3G runs `__notPosted` and `__byKind`. */
  category_summary: Record<string, unknown>;
  input_snapshot: unknown;
  input_fingerprint: string;
  created_by: string;
  created_at: string;
};

export type ItemRow = {
  id: number;
  reconciliation_id: number;
  item_order: number;
  statement_line_id: number | null;
  statement_line_order: number | null;
  category: string;
  sub_status: string;
  match_tier: string | null;
  precisia_ref_type: string | null;
  precisia_ref_id: number | null;
  related_refs: unknown;
  suggestions: unknown;
  statement_amount: number | string | null;
  precisia_amount: number | string | null;
  amount_difference: number | string | null;
  effect_on_difference: number | string;
  explained: boolean;
  explained_by_resolution_id: number | null;
  message: string;
};

export async function nextRunNumber(companyId: string, statementId: number): Promise<number> {
  const { data, error } = await systemClient()
    .from("supplier_statement_reconciliations")
    .select("run_number")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("run_number", { ascending: false })
    .limit(1)
    .returns<{ run_number: number }[]>();
  if (error) throw error;
  return (data[0]?.run_number ?? 0) + 1;
}

export async function insertRun(run: Omit<RunRow, "id" | "created_at">, items: Omit<ItemRow, "id" | "reconciliation_id">[], companyId: string): Promise<number> {
  const client = systemClient();
  const { data, error } = await client.from("supplier_statement_reconciliations").insert(run).select("id").single<{ id: number }>();
  if (error) throw error;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((item) => ({ ...item, reconciliation_id: data.id, company_id: companyId }));
    const { error: itemError } = await client.from("supplier_statement_reconciliation_items").insert(chunk);
    if (itemError) throw itemError;
  }
  return data.id;
}

export async function markStatementReconciled(companyId: string, statementId: number): Promise<void> {
  const { error } = await systemClient()
    .from("supplier_statements")
    .update({ status: "Reconciled", updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", statementId)
    .in("status", ["Ready", "Reconciled"]);
  if (error) throw error;
}

export async function listRuns(companyId: string, statementId: number): Promise<Omit<RunRow, "input_snapshot">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statement_reconciliations")
    .select("id, company_id, statement_id, run_number, engine_version, basis, supplier_id, as_at_date, window_from, window_to, statement_opening, statement_closing, precisia_balance_before_window, precisia_balance_at, difference, explained_amount, explained_by_reviewer_amount, unexplained_amount, category_summary, input_fingerprint, created_by, created_at")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("run_number", { ascending: false })
    .limit(200)
    .returns<Omit<RunRow, "input_snapshot">[]>();
  if (error) throw error;
  return data;
}

export async function getRun(companyId: string, statementId: number, runId: number): Promise<{ run: RunRow; items: ItemRow[] } | null> {
  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("supplier_statement_reconciliations")
    .select("*")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .eq("id", runId)
    .maybeSingle<RunRow>();
  if (error) throw error;
  if (!run) return null;
  const { data: items, error: itemsError } = await supabase
    .from("supplier_statement_reconciliation_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("reconciliation_id", runId)
    .order("item_order")
    .limit(20_000)
    .returns<ItemRow[]>();
  if (itemsError) throw itemsError;
  return { run, items };
}
