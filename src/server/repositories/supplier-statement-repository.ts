/**
 * SD-3C — supplier statements: data access.
 *
 * Two kinds of function, kept apart on purpose:
 *  - USER functions run under the signed-in user's session, so RLS (Purchasing
 *    permissions, company isolation) and the 0114 guard triggers decide what
 *    they may do — the reviewer's own actions;
 *  - SYSTEM functions use the service role, for the asynchronous processing
 *    (reading the file, writing what was read) and for validation results,
 *    which no user may write. They are only ever called by the service after
 *    the request's own permission check, or by the processing step itself.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { supplierFromRow, type SupplierRow } from "@/server/accounting/mappers";
import type { Supplier } from "@/server/accounting/types";
import type { StatementFinding } from "@/server/supplier-statements/validation";
import type {
  ExclusionReason,
  PrintedAgeing,
  SignConvention,
  StatementSourceType,
  StatementStatus,
  StatementTransactionType,
  StatementValidationStatus,
  UnresolvedField,
} from "@/server/supplier-statements/types";

const LIST_CAP = 500;
const LINE_CAP = 5000;

function systemClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supplier statement processing is not configured (SUPABASE_SERVICE_ROLE_KEY is missing).");
  }
  return createAdminClient();
}

export type StatementRow = {
  id: number;
  company_id: string;
  document_id: number;
  content_sha256: string;
  source_type: StatementSourceType;
  extraction_method: "layout" | "tabular" | "manual" | null;
  status: StatementStatus;
  status_reason: string;
  duplicate_of_statement_id: number | null;
  supplier_id: number | null;
  supplier_match_tier: string | null;
  supplier_candidates: unknown;
  supplier_confirmed_by: string | null;
  supplier_confirmed_at: string | null;
  supplier_name_extracted: string | null;
  supplier_vat_extracted: string | null;
  supplier_registration_extracted: string | null;
  account_number_extracted: string | null;
  statement_date: string | null;
  period_from: string | null;
  period_to: string | null;
  currency_code: string | null;
  opening_balance: number | string | null;
  closing_balance: number | string | null;
  printed_total_debits: number | string | null;
  printed_total_credits: number | string | null;
  printed_ageing: PrintedAgeing | null;
  sign_convention: SignConvention;
  page_count: number | null;
  validation_status: StatementValidationStatus;
  validation_findings: StatementFinding[];
  validated_at: string | null;
  extraction_snapshot: unknown;
  warnings: string[];
  manual_entry: boolean;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

export type StatementLineRow = {
  id: number;
  company_id: string;
  statement_id: number;
  line_order: number;
  page_number: number | null;
  row_on_page: number | null;
  transaction_date: string | null;
  reference_text: string | null;
  description: string | null;
  transaction_type: StatementTransactionType;
  type_source: "printed" | "inferred" | "reviewer";
  debit: number | string | null;
  credit: number | string | null;
  amount: number | string;
  running_balance: number | string | null;
  raw_text: string | null;
  unresolved_fields: UnresolvedField[];
  is_excluded: boolean;
  exclusion_reason: ExclusionReason | null;
  corrected: boolean;
  created_at: string;
  updated_at: string;
};

export type StatementEventRow = {
  id: number;
  statement_id: number;
  event_type: string;
  detail: Record<string, unknown>;
  performed_by: string;
  occurred_at: string;
};

export type StatementEventType =
  | "Uploaded" | "DuplicateEvaluated" | "ProcessingStarted" | "Extracted" | "ExtractionFailed" | "ManualEntryRequired"
  | "ValidationEvaluated" | "SupplierProposed" | "SupplierConfirmed" | "SupplierUnconfirmed" | "SupplierAccountNumberSaved"
  | "FieldCorrected" | "LineCorrected" | "LineAdded" | "LineRemoved" | "ManualEntryStarted" | "SubmittedForReview"
  | "MarkedReady" | "Reopened" | "Rejected" | "ProcessingRequeued";

/** Header fields a reviewer may correct (the guard enforces the same list). */
export type ReviewerStatementFields = Partial<{
  statement_date: string | null;
  period_from: string | null;
  period_to: string | null;
  currency_code: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  printed_total_debits: number | null;
  printed_total_credits: number | null;
  printed_ageing: PrintedAgeing | null;
  sign_convention: SignConvention;
  supplier_id: number | null;
  supplier_confirmed_at: string | null;
  status: StatementStatus;
}>;

export type ReviewerLineFields = Partial<{
  transaction_date: string | null;
  reference_text: string | null;
  description: string | null;
  transaction_type: StatementTransactionType;
  debit: number | null;
  credit: number | null;
  running_balance: number | null;
  is_excluded: boolean;
  exclusion_reason: string | null;
}>;

// ---------------------------------------------------------------------
// User (session) functions
// ---------------------------------------------------------------------

export async function insertStatement(input: { companyId: string; documentId: number; contentSha256: string; sourceType: "pdf" | "image" | "csv" | "xlsx" }): Promise<StatementRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statements")
    .insert({
      company_id: input.companyId,
      document_id: input.documentId,
      content_sha256: input.contentSha256,
      source_type: input.sourceType,
      // Overwritten by the guard with the session user; required by the column.
      uploaded_by: "session",
    })
    .select("*")
    .single<StatementRow>();
  if (error) throw error;
  return data;
}

export async function getStatement(companyId: string, statementId: number): Promise<StatementRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statements")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", statementId)
    .maybeSingle<StatementRow>();
  if (error) throw error;
  return data;
}

export async function listStatements(companyId: string, options: { status?: StatementStatus; limit?: number } = {}): Promise<StatementRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("supplier_statements")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(Math.min(options.limit ?? LIST_CAP, LIST_CAP));
  if (options.status) query = query.eq("status", options.status);
  const { data, error } = await query.returns<StatementRow[]>();
  if (error) throw error;
  return data;
}

export async function listStatementLines(companyId: string, statementId: number): Promise<StatementLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statement_lines")
    .select("*")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("line_order")
    .limit(LINE_CAP)
    .returns<StatementLineRow[]>();
  if (error) throw error;
  return data;
}

export async function listStatementEvents(companyId: string, statementId: number): Promise<StatementEventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statement_events")
    .select("id, statement_id, event_type, detail, performed_by, occurred_at")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("occurred_at")
    .limit(LIST_CAP)
    .returns<StatementEventRow[]>();
  if (error) throw error;
  return data;
}

export async function updateStatementAsReviewer(companyId: string, statementId: number, fields: ReviewerStatementFields): Promise<StatementRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statements")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", statementId)
    .select("*")
    .maybeSingle<StatementRow>();
  if (error) throw error;
  if (!data) throw new Error(`Statement ${statementId} was not updated.`);
  return data;
}

export async function updateLineAsReviewer(companyId: string, statementId: number, lineId: number, fields: ReviewerLineFields): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statement_lines")
    .update(fields)
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .eq("id", lineId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`Line ${lineId} was not updated.`);
}

export async function addLinesAsReviewer(companyId: string, statementId: number, lines: ReviewerLineFields[]): Promise<void> {
  if (lines.length === 0) return;
  const supabase = await createClient();
  const { data: last, error: lastError } = await supabase
    .from("supplier_statement_lines")
    .select("line_order")
    .eq("statement_id", statementId)
    .order("line_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ line_order: number }>();
  if (lastError) throw lastError;
  let next = (last?.line_order ?? 0) + 1;
  const rows = lines.map((line) => ({ ...line, company_id: companyId, statement_id: statementId, line_order: next++ }));
  const { error } = await supabase.from("supplier_statement_lines").insert(rows);
  if (error) throw error;
}

export async function removeLineAsReviewer(companyId: string, statementId: number, lineId: number): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_statement_lines")
    .delete()
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .eq("id", lineId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`Line ${lineId} was not removed.`);
}

/** A reviewer's own event; the database takes the actor from the session. */
export async function recordStatementEvent(companyId: string, statementId: number, eventType: StatementEventType, detail: Record<string, unknown> = {}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_supplier_statement_record_event", {
    p_company_id: companyId,
    p_statement_id: statementId,
    p_event_type: eventType,
    p_detail: detail,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// System (service-role) functions
// ---------------------------------------------------------------------

export async function getStatementAsSystem(companyId: string, statementId: number): Promise<StatementRow | null> {
  const { data, error } = await systemClient()
    .from("supplier_statements")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", statementId)
    .maybeSingle<StatementRow>();
  if (error) throw error;
  return data;
}

export async function listStatementLinesAsSystem(companyId: string, statementId: number): Promise<StatementLineRow[]> {
  const { data, error } = await systemClient()
    .from("supplier_statement_lines")
    .select("*")
    .eq("company_id", companyId)
    .eq("statement_id", statementId)
    .order("line_order")
    .limit(LINE_CAP)
    .returns<StatementLineRow[]>();
  if (error) throw error;
  return data;
}

export async function getDocumentForProcessing(companyId: string, documentId: number): Promise<{ storagePath: string; filename: string; mimeType: string } | null> {
  const { data, error } = await systemClient()
    .from("documents")
    .select("storage_path, filename, mime_type")
    .eq("company_id", companyId)
    .eq("id", documentId)
    .maybeSingle<{ storage_path: string; filename: string; mime_type: string }>();
  if (error) throw error;
  return data ? { storagePath: data.storage_path, filename: data.filename, mimeType: data.mime_type } : null;
}

/** Atomically takes a queued statement for processing: only one processor
 * can move it from Queued to Processing. */
export async function claimQueuedStatement(companyId: string, statementId: number): Promise<StatementRow | null> {
  const { data, error } = await systemClient()
    .from("supplier_statements")
    .update({ status: "Processing", updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", statementId)
    .eq("status", "Queued")
    .select("*")
    .maybeSingle<StatementRow>();
  if (error) throw error;
  return data;
}

export async function updateStatementAsSystem(companyId: string, statementId: number, fields: Record<string, unknown>): Promise<void> {
  const { error } = await systemClient()
    .from("supplier_statements")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", statementId);
  if (error) throw error;
}

/** Writes only if the statement has not changed since `updatedAt` — so a
 * validation verdict always describes the values it was computed from. */
export async function updateStatementAsSystemIfUnchanged(companyId: string, statementId: number, updatedAt: string, fields: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await systemClient()
    .from("supplier_statements")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", statementId)
    .eq("updated_at", updatedAt)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type NewSystemLine = {
  line_order: number;
  page_number: number | null;
  row_on_page: number | null;
  transaction_date: string | null;
  reference_text: string | null;
  description: string | null;
  transaction_type: StatementTransactionType;
  type_source: "printed" | "inferred";
  debit: number | null;
  credit: number | null;
  running_balance: number | null;
  raw_text: string;
  unresolved_fields: UnresolvedField[];
  is_excluded: boolean;
  exclusion_reason: ExclusionReason | null;
};

export async function replaceLinesAsSystem(companyId: string, statementId: number, lines: NewSystemLine[]): Promise<void> {
  const client = systemClient();
  const { error: deleteError } = await client.from("supplier_statement_lines").delete().eq("company_id", companyId).eq("statement_id", statementId);
  if (deleteError) throw deleteError;
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500).map((l) => ({ ...l, company_id: companyId, statement_id: statementId }));
    const { error } = await client.from("supplier_statement_lines").insert(chunk);
    if (error) throw error;
  }
}

export async function recordSystemStatementEvent(
  companyId: string,
  statementId: number,
  eventType: StatementEventType,
  detail: Record<string, unknown>,
  performedBy: string,
): Promise<void> {
  const { error } = await systemClient().rpc("fn_supplier_statement_record_system_event", {
    p_company_id: companyId,
    p_statement_id: statementId,
    p_event_type: eventType,
    p_detail: detail,
    p_performed_by: performedBy,
  });
  if (error) throw error;
}

/** Other statements of this company with the same bytes, and their status. */
export async function findStatementsWithSameFile(companyId: string, contentSha256: string, excludeId: number): Promise<{ id: number; status: StatementStatus }[]> {
  const { data, error } = await systemClient()
    .from("supplier_statements")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("content_sha256", contentSha256)
    .neq("id", excludeId)
    .order("id")
    .limit(20)
    .returns<{ id: number; status: StatementStatus }[]>();
  if (error) throw error;
  return data;
}

/** Another live statement for the same supplier, date and closing balance. */
export async function findSimilarStatement(companyId: string, statementId: number, supplierId: number, statementDate: string, closingBalance: number): Promise<number | null> {
  const { data, error } = await systemClient()
    .from("supplier_statements")
    .select("id")
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .eq("statement_date", statementDate)
    .eq("closing_balance", closingBalance)
    .neq("id", statementId)
    .not("status", "in", "(Rejected,Duplicate)")
    .order("id")
    .limit(1)
    .returns<{ id: number }[]>();
  if (error) throw error;
  return data[0]?.id ?? null;
}

export async function getCompanyBaseCurrency(companyId: string): Promise<string | null> {
  const { data, error } = await systemClient()
    .from("companies")
    .select("base_currency_code")
    .eq("id", companyId)
    .maybeSingle<{ base_currency_code: string | null }>();
  if (error) throw error;
  return data?.base_currency_code ?? null;
}

/** The company's suppliers and the account number each has recorded, for
 * the matching PROPOSAL (never for creating or confirming anything). */
export async function listSuppliersForMatching(companyId: string): Promise<{ suppliers: Supplier[]; accountNumbers: Map<number, string | null> }> {
  const { data, error } = await systemClient()
    .from("ae_suppliers")
    .select("*")
    .eq("company_id", companyId)
    .order("name")
    .limit(10_000)
    .returns<(SupplierRow & { our_account_number: string | null })[]>();
  if (error) throw error;
  return {
    suppliers: data.map((row) => supplierFromRow(row)),
    accountNumbers: new Map(data.map((row) => [row.id, row.our_account_number ?? null])),
  };
}

/** Statements stuck in Processing (the processor stopped mid-way). */
export async function requeueStaleProcessing(companyId: string, statementId: number, olderThanIso: string): Promise<boolean> {
  const { data, error } = await systemClient()
    .from("supplier_statements")
    .update({ status: "Queued", updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", statementId)
    .eq("status", "Processing")
    .lt("updated_at", olderThanIso)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
