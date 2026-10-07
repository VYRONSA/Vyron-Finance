/**
 * Repository layer for VYRON AI Supplier Invoice Capture (migration 0108).
 *
 * Every query is scoped by `company_id` in addition to the RLS policy —
 * belt and braces, the convention every other repository here follows. The
 * feature's own tables carry a real tenant predicate with `WITH CHECK`, not
 * VYRON COST's `using (true)`.
 *
 * This file never touches `ae_imported_bills`, `ae_journals` or
 * `gl_transactions`. Conversion goes through `purchase-bill-service`, and
 * `accounting-reconciliation.test.ts` asserts that no module in this
 * feature writes to an accounting table.
 *
 * Phase SD-0 (migration 0111) — two kinds of write, two clients:
 *  * reviewer actions (upload, correct, reject, convert) use the caller's
 *    session, so RLS and the capture guard trigger check the caller's own
 *    Purchasing permissions and the actor comes from the session;
 *  * system processing (extraction, validation, duplicate evaluation, the
 *    AI gate and attempt log) uses the service-role client, as the AI
 *    classification safety repository does, because no signed-in user may
 *    write those results — whichever context the work runs in (the
 *    unattended runner or a user's "Run Task Now").
 */

import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SameFileDocument } from "@/server/supplier-invoice-capture/duplicate-detection";
import type {
  CaptureStatus,
  DuplicateStatus,
  GlAccountSource,
  SupplierMatchTier,
  ValidationStatus,
  VatCodeSource,
} from "@/server/supplier-invoice-capture/types";

const LIST_CAP = 500;

function systemClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supplier invoice capture processing is not configured (SUPABASE_SERVICE_ROLE_KEY is missing).");
  }
  return createAdminClient();
}

export type CaptureRow = {
  id: number;
  company_id: string;
  document_id: number;
  status: CaptureStatus;
  /** Phase 5N — what the document's own heading said it is. Informational
   * at review; a structural refusal at conversion for anything that is not
   * an Invoice. Null on every capture taken before 0109, and null is not
   * treated as suspicious. */
  document_type: string | null;
  supplier_name_extracted: string | null;
  supplier_vat_number_extracted: string | null;
  supplier_registration_number_extracted: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  order_reference: string | null;
  currency_code: string | null;
  subtotal: number | null;
  discount_total: number | null;
  vat_amount: number | null;
  total: number | null;
  supplier_id: number | null;
  supplier_match_tier: SupplierMatchTier | null;
  supplier_candidates: unknown;
  validation_status: ValidationStatus;
  validation_findings: unknown;
  model_confidence: number | null;
  duplicate_status: DuplicateStatus;
  duplicate_of_capture_id: number | null;
  duplicate_of_bill_id: number | null;
  duplicate_reason: string;
  extraction_attempts: number;
  last_error_category: string | null;
  last_error_message: string | null;
  bill_id: number | null;
  converted_at: string | null;
  converted_by: string | null;
  /** SD-1 (0112) — the extraction exactly as received; null for a manual entry. */
  extraction_snapshot: unknown;
  manual_entry: boolean;
  validated_at: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

export type CaptureLineRow = {
  id: number;
  capture_id: number;
  line_order: number;
  description: string;
  supplier_sku: string | null;
  quantity: number | null;
  uom: string | null;
  pack_description: string | null;
  pack_quantity: number | null;
  unit_price: number | null;
  discount: number | null;
  vat_rate_percent: number | null;
  vat_amount: number | null;
  line_total: number | null;
  gl_account_suggested: string | null;
  gl_account_source: GlAccountSource | null;
  vat_code_suggested: string | null;
  vat_code_source: VatCodeSource | null;
  gl_account_confirmed: string | null;
  vat_code_confirmed: string | null;
  is_excluded: boolean;
  line_confidence: number | null;
};

export async function createCapture(companyId: string, documentId: number, uploadedBy: string): Promise<CaptureRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_captures")
    .insert({ company_id: companyId, document_id: documentId, uploaded_by: uploadedBy, status: "Uploaded" })
    .select("*")
    .single<CaptureRow>();
  if (error) throw error;
  return data;
}

export async function getCapture(companyId: string, captureId: number): Promise<CaptureRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_captures")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", captureId)
    .maybeSingle<CaptureRow>();
  if (error) throw error;
  return data;
}

/** System reads (SD-1): duplicate evaluation and re-validation must see
 * the capture whatever the current user may read. */
export async function getCaptureAsSystem(companyId: string, captureId: number): Promise<CaptureRow | null> {
  const { data, error } = await systemClient()
    .from("supplier_invoice_captures")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", captureId)
    .maybeSingle<CaptureRow>();
  if (error) throw error;
  return data;
}

export async function listCaptureLinesAsSystem(companyId: string, captureId: number): Promise<CaptureLineRow[]> {
  const { data, error } = await systemClient()
    .from("supplier_invoice_capture_lines")
    .select("*")
    .eq("company_id", companyId)
    .eq("capture_id", captureId)
    .order("line_order", { ascending: true })
    .returns<CaptureLineRow[]>();
  if (error) throw error;
  return data;
}

export async function getDocumentHashAsSystem(companyId: string, documentId: number): Promise<string | null> {
  const { data, error } = await systemClient()
    .from("documents")
    .select("content_sha256")
    .eq("company_id", companyId)
    .eq("id", documentId)
    .maybeSingle<{ content_sha256: string | null }>();
  if (error) throw error;
  return data?.content_sha256 ?? null;
}

export async function getCaptureByDocument(companyId: string, documentId: number): Promise<CaptureRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_captures")
    .select("*")
    .eq("company_id", companyId)
    .eq("document_id", documentId)
    .maybeSingle<CaptureRow>();
  if (error) throw error;
  return data;
}

export type CaptureListFilter = { status?: CaptureStatus | "All"; search?: string; limit?: number };

/** Bounded by construction — the brief is explicit that the inbox must not
 * load an unbounded list, and COST's own learning lookup capped at 500 and
 * then scanned it linearly per line. */
export async function listCaptures(companyId: string, filter: CaptureListFilter = {}): Promise<CaptureRow[]> {
  const supabase = await createClient();
  let query = supabase.from("supplier_invoice_captures").select("*").eq("company_id", companyId);
  if (filter.status && filter.status !== "All") query = query.eq("status", filter.status);
  const search = filter.search?.trim();
  if (search) {
    const escaped = search.replace(/[%_,()]/g, " ");
    query = query.or(`invoice_number.ilike.%${escaped}%,supplier_name_extracted.ilike.%${escaped}%`);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(Math.min(filter.limit ?? 100, LIST_CAP))
    .returns<CaptureRow[]>();
  if (error) throw error;
  return data;
}

/** Captures whose extraction work is outstanding. Ordered oldest first so
 * a backlog drains fairly rather than starving the earliest upload. */
export async function listCapturesAwaitingExtraction(companyId: string, limit: number): Promise<CaptureRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_captures")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "Queued")
    .order("created_at", { ascending: true })
    .limit(Math.min(limit, LIST_CAP))
    .returns<CaptureRow[]>();
  if (error) throw error;
  return data;
}

export async function listCaptureLines(companyId: string, captureId: number): Promise<CaptureLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_capture_lines")
    .select("*")
    .eq("company_id", companyId)
    .eq("capture_id", captureId)
    .order("line_order", { ascending: true })
    .returns<CaptureLineRow[]>();
  if (error) throw error;
  return data;
}

/** A reviewer's change, under the caller's session. The capture guard
 * trigger (0111) decides which fields and transitions the caller's
 * Purchasing permissions allow. */
export async function updateCaptureAsReviewer(companyId: string, captureId: number, fields: Record<string, unknown>): Promise<CaptureRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_captures")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", captureId)
    .select("*")
    .single<CaptureRow>();
  if (error) throw error;
  return data;
}

/** System processing results (queue state, extraction, validation,
 * duplicate verdicts). Service role only. */
export async function updateCaptureAsSystem(companyId: string, captureId: number, fields: Record<string, unknown>): Promise<CaptureRow> {
  const { data, error } = await systemClient()
    .from("supplier_invoice_captures")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", captureId)
    .select("*")
    .single<CaptureRow>();
  if (error) throw error;
  return data;
}

/** System write that applies only if the capture has not changed since it
 * was read (`updated_at` as read). Returns null when it had — e.g. a
 * reviewer corrected it while it was being validated — so a verdict is
 * never recorded against values it did not see. */
export async function updateCaptureAsSystemIfUnchanged(
  companyId: string,
  captureId: number,
  readUpdatedAt: string,
  fields: Record<string, unknown>,
): Promise<CaptureRow | null> {
  const { data, error } = await systemClient()
    .from("supplier_invoice_captures")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", captureId)
    .eq("updated_at", readUpdatedAt)
    .select("*")
    .maybeSingle<CaptureRow>();
  if (error) throw error;
  return data;
}

/**
 * Claims a capture for extraction.
 *
 * Conditional on its current status, so two runners cannot both claim the
 * same document — the same technique the posting engine uses to claim
 * journals. Returns null when another runner got there first.
 */
export async function claimCaptureForExtraction(companyId: string, captureId: number): Promise<CaptureRow | null> {
  const { data, error } = await systemClient()
    .from("supplier_invoice_captures")
    .update({ status: "Extracting", updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", captureId)
    .eq("status", "Queued")
    .select("*")
    .maybeSingle<CaptureRow>();
  if (error) throw error;
  return data;
}

/** Replaces a capture's lines wholesale. Extraction is the only writer of
 * the extracted columns; review updates confirmations in place. */
export async function replaceCaptureLines(
  companyId: string,
  captureId: number,
  lines: Omit<CaptureLineRow, "id" | "capture_id">[],
): Promise<void> {
  const supabase = systemClient();
  const { error: deleteError } = await supabase
    .from("supplier_invoice_capture_lines")
    .delete()
    .eq("company_id", companyId)
    .eq("capture_id", captureId);
  if (deleteError) throw deleteError;
  if (lines.length === 0) return;
  const { error } = await supabase
    .from("supplier_invoice_capture_lines")
    .insert(lines.map((line) => ({ ...line, company_id: companyId, capture_id: captureId })));
  if (error) throw error;
}

/** The line values a reviewer may set (0112): what the document shows, and
 * the reviewer's GL/VAT confirmations. Suggestions stay system-owned. */
export type ReviewerLineFields = Partial<Pick<
  CaptureLineRow,
  | "description" | "supplier_sku" | "quantity" | "uom" | "unit_price" | "discount"
  | "vat_rate_percent" | "vat_amount" | "line_total"
  | "gl_account_confirmed" | "vat_code_confirmed" | "is_excluded"
>>;

/** Adds reviewer-entered lines after the existing ones (manual entry, or a
 * line the extraction missed). */
export async function addCaptureLinesAsReviewer(companyId: string, captureId: number, lines: ReviewerLineFields[]): Promise<void> {
  if (lines.length === 0) return;
  const supabase = await createClient();
  const { data: last, error: lastError } = await supabase
    .from("supplier_invoice_capture_lines")
    .select("line_order")
    .eq("company_id", companyId)
    .eq("capture_id", captureId)
    .order("line_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ line_order: number }>();
  if (lastError) throw lastError;
  const start = (last?.line_order ?? -1) + 1;
  const { error } = await supabase
    .from("supplier_invoice_capture_lines")
    .insert(lines.map((line, i) => ({ description: "", ...line, company_id: companyId, capture_id: captureId, line_order: start + i })));
  if (error) throw error;
}

export async function removeCaptureLineAsReviewer(companyId: string, captureId: number, lineOrder: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("supplier_invoice_capture_lines")
    .delete()
    .eq("company_id", companyId)
    .eq("capture_id", captureId)
    .eq("line_order", lineOrder);
  if (error) throw error;
}

export async function updateCaptureLine(
  companyId: string,
  captureId: number,
  lineOrder: number,
  fields: ReviewerLineFields,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("supplier_invoice_capture_lines")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("capture_id", captureId)
    .eq("line_order", lineOrder);
  if (error) throw error;
}

export type CaptureEventType =
  | "Uploaded" | "Queued" | "ExtractionStarted" | "ExtractionSucceeded" | "ExtractionFailed"
  | "ValidationEvaluated" | "SupplierResolved" | "DuplicateEvaluated" | "FieldCorrected"
  | "SupplierCreated" | "ConvertedToBill" | "Cancelled" | "Requeued"
  | "ManualEntryStarted" | "SubmittedForReview";

/** The events a reviewer's own action produces (0111/0112 accept only these
 * from a signed-in user, each with the permission and state it implies). */
export type ReviewerCaptureEventType =
  | "Queued" | "FieldCorrected" | "Cancelled" | "ConvertedToBill" | "ManualEntryStarted" | "SubmittedForReview";

/** Appends one audit event for a reviewer's action. The actor is taken
 * from the session by the database — there is deliberately no parameter
 * for it. `detail` must be metadata — never document content;
 * `pii-logging.test.ts` covers the shape callers may pass. */
export async function recordCaptureEvent(
  companyId: string,
  captureId: number,
  eventType: ReviewerCaptureEventType,
  detail: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_supplier_invoice_capture_record_event", {
    p_company_id: companyId,
    p_capture_id: captureId,
    p_event_type: eventType,
    p_detail: detail,
  });
  if (error) throw error;
}

/** Appends one audit event for system processing. Service role only;
 * `performedBy` is the actor the server established (the runner, or the
 * session that triggered the work). */
export async function recordSystemCaptureEvent(
  companyId: string,
  captureId: number,
  eventType: CaptureEventType,
  detail: Record<string, unknown>,
  performedBy: string,
): Promise<void> {
  const { error } = await systemClient().rpc("fn_supplier_invoice_capture_record_system_event", {
    p_company_id: companyId,
    p_capture_id: captureId,
    p_event_type: eventType,
    p_detail: detail,
    p_performed_by: performedBy,
  });
  if (error) throw error;
}

export type CaptureEventRow = {
  id: number;
  capture_id: number;
  event_type: CaptureEventType;
  detail: Record<string, unknown>;
  performed_by: string;
  occurred_at: string;
};

export async function listCaptureEvents(companyId: string, captureId: number): Promise<CaptureEventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_invoice_capture_events")
    .select("*")
    .eq("company_id", companyId)
    .eq("capture_id", captureId)
    .order("occurred_at", { ascending: false })
    .limit(LIST_CAP)
    .returns<CaptureEventRow[]>();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Duplicate evidence — read with the service role (SD-1).
//
// A duplicate check must see every record that could make this capture a
// duplicate, whatever the current user is allowed to read; reading under
// the session would let a narrower role miss the very bill that should
// block it. The queries are targeted (same supplier, same file) and paged,
// rather than an unordered first-500 of the whole company.
// ---------------------------------------------------------------------

const DUPLICATE_PAGE = 1000;
const DUPLICATE_MAX_PAGES = 20;

type CaptureCandidateRow = { id: number; supplier_id: number | null; invoice_number: string | null; invoice_date: string | null; total: number | string | null; status: string; documents: { content_sha256: string | null } | null };

export type DuplicateCaptureCandidate = {
  captureId: number; supplierId: number | null; invoiceNumber: string | null; invoiceDate: string | null; total: number | null; contentSha256: string | null; status: string;
};

/** Captures that could duplicate this one: every capture of the same
 * supplier, and every capture of a document with the same bytes. */
export async function listDuplicateCandidates(
  companyId: string,
  subject: { supplierId: number | null; contentSha256: string | null },
): Promise<DuplicateCaptureCandidate[]> {
  const supabase = systemClient();
  const byId = new Map<number, DuplicateCaptureCandidate>();
  const take = (rows: CaptureCandidateRow[]) => {
    for (const row of rows) {
      byId.set(row.id, {
        captureId: row.id,
        supplierId: row.supplier_id ?? null,
        invoiceNumber: row.invoice_number ?? null,
        invoiceDate: row.invoice_date ?? null,
        total: row.total === null || row.total === undefined ? null : Number(row.total),
        contentSha256: row.documents?.content_sha256 ?? null,
        status: row.status,
      });
    }
  };
  const select = "id, supplier_id, invoice_number, invoice_date, total, status, documents!inner(content_sha256)";

  if (subject.supplierId !== null) {
    for (let page = 0; page < DUPLICATE_MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from("supplier_invoice_captures")
        .select(select)
        .eq("company_id", companyId)
        .eq("supplier_id", subject.supplierId)
        .order("id", { ascending: true })
        .range(page * DUPLICATE_PAGE, (page + 1) * DUPLICATE_PAGE - 1)
        .returns<CaptureCandidateRow[]>();
      if (error) throw error;
      take(data ?? []);
      if ((data ?? []).length < DUPLICATE_PAGE) break;
    }
  }
  if (subject.contentSha256) {
    const { data, error } = await supabase
      .from("supplier_invoice_captures")
      .select(select)
      .eq("company_id", companyId)
      .eq("documents.content_sha256", subject.contentSha256)
      .order("id", { ascending: true })
      .limit(LIST_CAP)
      .returns<CaptureCandidateRow[]>();
    if (error) throw error;
    take(data ?? []);
  }
  return [...byId.values()];
}

/** Every bill of the supplier (paged), for the supplier + number and the
 * supplier + amount checks. */
export async function listBillDuplicateCandidates(companyId: string, supplierId: number): Promise<
  { billId: number; supplierId: number; invoiceNumber: string; invoiceDate: string | null; total: number | null }[]
> {
  const supabase = systemClient();
  const out: { billId: number; supplierId: number; invoiceNumber: string; invoiceDate: string | null; total: number | null }[] = [];
  for (let page = 0; page < DUPLICATE_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("ae_imported_bills")
      .select("id, supplier_id, invoice_number, invoice_date, total")
      .eq("company_id", companyId)
      .eq("supplier_id", supplierId)
      .order("id", { ascending: true })
      .range(page * DUPLICATE_PAGE, (page + 1) * DUPLICATE_PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      out.push({
        billId: row.id as number,
        supplierId: row.supplier_id as number,
        invoiceNumber: (row.invoice_number as string) ?? "",
        invoiceDate: (row.invoice_date as string | null) ?? null,
        total: row.total === null || row.total === undefined ? null : Number(row.total),
      });
    }
    if ((data ?? []).length < DUPLICATE_PAGE) break;
  }
  return out;
}

/**
 * SD-1 — every stored document of this company with the same bytes, with
 * the capture (if any) made from each. Ordered, and the caller excludes the
 * document being uploaded: the previous `.limit(1).maybeSingle()` could
 * return the new document itself (it already carries its hash), so the real
 * earlier copy went unseen.
 */
export async function findSameFileDocuments(companyId: string, contentSha256: string): Promise<SameFileDocument[]> {
  const supabase = systemClient();
  const { data: documents, error } = await supabase
    .from("documents")
    .select("id, filename")
    .eq("company_id", companyId)
    .eq("content_sha256", contentSha256)
    .order("id", { ascending: true })
    .limit(LIST_CAP)
    .returns<{ id: number; filename: string }[]>();
  if (error) throw error;
  if (!documents || documents.length === 0) return [];

  const { data: captures, error: captureError } = await supabase
    .from("supplier_invoice_captures")
    .select("id, document_id, status")
    .eq("company_id", companyId)
    .in("document_id", documents.map((d) => d.id))
    .returns<{ id: number; document_id: number; status: string }[]>();
  if (captureError) throw captureError;
  const captureByDocument = new Map((captures ?? []).map((c) => [c.document_id, c]));

  return documents.map((d) => ({
    documentId: d.id,
    filename: d.filename,
    captureId: captureByDocument.get(d.id)?.id ?? null,
    captureStatus: captureByDocument.get(d.id)?.status ?? null,
  }));
}

// ---------------------------------------------------------------------
// SD-2 — what the Supplier Documents screens show beside each capture:
// the purchase document it became, and the original file. Read under the
// caller's session (they are already allowed to see the capture).
// ---------------------------------------------------------------------

export type CaptureBillSummary = { id: number; invoiceNumber: string; documentType: string; postingStatus: string | null; total: number | null };
export type CaptureDocumentSummary = { id: number; filename: string; mimeType: string; sizeBytes: number; uploadedAt: string };

export async function listBillSummaries(companyId: string, billIds: number[]): Promise<CaptureBillSummary[]> {
  if (billIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select("id, invoice_number, document_type, posting_status, total")
    .eq("company_id", companyId)
    .in("id", billIds);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as number,
    invoiceNumber: (row.invoice_number as string) ?? "",
    documentType: (row.document_type as string) ?? "Bill",
    postingStatus: (row.posting_status as string | null) ?? null,
    total: row.total === null || row.total === undefined ? null : Number(row.total),
  }));
}

export async function listDocumentSummaries(companyId: string, documentIds: number[]): Promise<CaptureDocumentSummary[]> {
  if (documentIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, mime_type, size_bytes, uploaded_at")
    .eq("company_id", companyId)
    .in("id", documentIds);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as number,
    filename: (row.filename as string) ?? "",
    mimeType: (row.mime_type as string) ?? "",
    sizeBytes: Number(row.size_bytes ?? 0),
    uploadedAt: (row.uploaded_at as string) ?? "",
  }));
}

// ---------------------------------------------------------------------
// Learning — keyed by supplier_id, written only from a human-approved
// conversion. Failures are surfaced, never swallowed (COST logged a
// console.warn and reported success).
// ---------------------------------------------------------------------

export type LearnedMapping = { descriptionNormalised: string; supplierSkuNormalised: string; glAccount: string; vatCode: string };

export async function listLearnedMappings(companyId: string, supplierId: number): Promise<LearnedMapping[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_line_mappings")
    .select("description_normalised, supplier_sku_normalised, gl_account, vat_code")
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .eq("disabled", false)
    .order("times_confirmed", { ascending: false })
    .limit(LIST_CAP);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    descriptionNormalised: row.description_normalised as string,
    supplierSkuNormalised: (row.supplier_sku_normalised as string) ?? "",
    glAccount: (row.gl_account as string) ?? "",
    vatCode: (row.vat_code as string) ?? "",
  }));
}

export async function upsertLearnedMapping(
  companyId: string,
  supplierId: number,
  mapping: LearnedMapping & { captureId: number },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_upsert_supplier_line_mapping", {
    p_company_id: companyId,
    p_supplier_id: supplierId,
    p_description_normalised: mapping.descriptionNormalised,
    p_supplier_sku_normalised: mapping.supplierSkuNormalised,
    p_gl_account: mapping.glAccount,
    p_vat_code: mapping.vatCode,
    p_capture_id: mapping.captureId,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// AI safety — the shared gate and recorder from 0107/0108.
// ---------------------------------------------------------------------

export type ExtractionGateDecision = {
  decision: "allow" | "probe" | "circuit_open" | "daily_cap";
  circuit_state?: string;
  open_reason?: string | null;
  next_probe_at?: string | null;
  refused_layer?: "scope" | "provider" | null;
  requests_today?: number | null;
  daily_cap?: number | null;
};

export async function openExtractionGate(companyId: string, captureId: number): Promise<ExtractionGateDecision> {
  const { data, error } = await systemClient().rpc("fn_ai_extraction_gate", { p_company_id: companyId, p_capture_id: captureId });
  if (error) throw error;
  return data as ExtractionGateDecision;
}

export async function recordExtractionAttempt(input: {
  companyId: string;
  captureId: number;
  taskRunId: number | null;
  attemptNumber: number;
  outcome: "extracted" | "validation_failed" | "invalid_response" | "provider_error" | "document_error" | "write_error";
  providerRequestMade: boolean;
  model: string | null;
  errorCategory: string | null;
  httpStatus: number | null;
  /** MUST already be sanitised — `sanitizeProviderMessage` at the boundary. */
  providerMessage: string | null;
  usage: Record<string, unknown> | null;
  durationMs: number | null;
  performedBy: string;
  circuitSignal: "success" | "auth" | "timeout" | "provider_failure" | "rate_limit" | "none";
  probe: boolean;
}): Promise<void> {
  const { error } = await systemClient().rpc("fn_ai_extraction_record_attempt", {
    p_company_id: input.companyId,
    p_capture_id: input.captureId,
    p_task_run_id: input.taskRunId,
    p_attempt_number: input.attemptNumber,
    p_outcome: input.outcome,
    p_provider_request_made: input.providerRequestMade,
    p_model: input.model,
    p_error_category: input.errorCategory,
    p_http_status: input.httpStatus,
    p_provider_message: input.providerMessage,
    p_usage: input.usage,
    p_duration_ms: input.durationMs,
    p_performed_by: input.performedBy,
    p_circuit_signal: input.circuitSignal,
    p_probe: input.probe,
  });
  if (error) throw error;
}
