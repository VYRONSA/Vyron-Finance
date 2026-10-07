/**
 * Service layer for VYRON AI Supplier Invoice Capture.
 *
 * The orchestration, and nothing else. Every decision it makes is made by a
 * pure module in `@/server/supplier-invoice-capture/` that is unit-tested on
 * its own; this file's job is to call them in the right order, through the
 * existing AI safety machinery, and to persist the result.
 *
 * Three invariants hold throughout, and each is asserted by a test:
 *
 *  1. **No accounting.** Conversion calls `purchase-bill-service`; nothing
 *     here writes a journal, a ledger entry or a bill row directly.
 *  2. **No bypass.** There is no `force`, no override, no PIN, and the
 *     actor always comes from the session — never from a request body.
 *  3. **No invoice content in a log or an audit row.** Everything emitted
 *     goes through `redaction.ts`.
 */

import * as repo from "@/server/repositories/supplier-invoice-capture-repository";
import { listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { getCompany } from "@/server/repositories/company-repository";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import {
  cancelBill,
  createPurchaseBill,
  previewPurchaseBillTotals,
  ValidationError as BillValidationError,
  type CreatePurchaseBillInput,
} from "@/server/services/purchase-bill-service";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { assessConversion, conversionApprovalAmount, type ConversionLine } from "@/server/supplier-invoice-capture/conversion";
import { assessDuplicate, assessFileHashMatches } from "@/server/supplier-invoice-capture/duplicate-detection";
import { buildReviewedExtraction, readExtractionSnapshot, type ExtractionSnapshot } from "@/server/supplier-invoice-capture/review-validation";
import { normaliseDescription, normaliseSku, suggestGlAccount, suggestVatCode } from "@/server/supplier-invoice-capture/gl-vat-suggestion";
import { parsePackDescription } from "@/server/supplier-invoice-capture/pack-size";
import { logExtractionEvent, operatorMessageFor, sanitizeProviderMessage } from "@/server/supplier-invoice-capture/redaction";
import { resolveSupplier } from "@/server/supplier-invoice-capture/supplier-resolution";
import { shouldRetryExtraction, validateExtraction } from "@/server/supplier-invoice-capture/validation";
import {
  circuitSignalFor,
  providerWasReached,
  UnavailableExtractionProvider,
  type ExtractionProvider,
} from "@/server/supplier-invoice-capture/extraction-provider";
import { selectExtractionProvider } from "@/server/supplier-invoice-capture/provider-selection";
import type { ExtractionResult, ValidationStatus } from "@/server/supplier-invoice-capture/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

/** Bounded, per the retry policy: a deterministic failure may be retried,
 * but never indefinitely, and never because confidence was low. */
export const MAX_EXTRACTION_ATTEMPTS = 3;

/**
 * The provider injection point — the same shape `document-service.ts` uses
 * for `OcrProvider`. The default extracts nothing and says so, so an
 * environment with no AI configured still captures documents and lets a
 * person type them.
 *
 * Phase 5L shipped this as the only provider. Phase 5N moves the decision
 * into `provider-selection.ts`, which stays off unless the certification
 * switch is deliberately set AND a credential is present. This constant
 * remains the fail-closed answer, and remains what a caller gets whenever
 * that decision says "unavailable".
 */
export const defaultExtractionProvider: ExtractionProvider = new UnavailableExtractionProvider();

// ---------------------------------------------------------------------
// Upload → queue
// ---------------------------------------------------------------------

export type QueueResult = {
  captureId: number;
  status: "Queued" | "Duplicate";
  duplicateOfDocumentId: number | null;
  message: string | null;
};

/**
 * Registers an already-stored document for extraction.
 *
 * The file-hash duplicate check runs HERE, before any AI request, so a
 * re-uploaded file never costs a provider call. COST computed this warning
 * and then discarded it in the only UI that called the endpoint; here the
 * result is returned AND persisted on the capture.
 */
export async function queueDocumentForExtraction(
  companyId: string,
  documentId: number,
  contentSha256: string | null,
): Promise<QueueResult> {
  const performedBy = await getPerformedByLabel();

  const existing = await repo.getCaptureByDocument(companyId, documentId);
  const capture = existing ?? (await repo.createCapture(companyId, documentId, performedBy));

  if (existing && existing.status !== "Uploaded" && existing.status !== "Failed") {
    return { captureId: existing.id, status: existing.status === "Duplicate" ? "Duplicate" : "Queued", duplicateOfDocumentId: null, message: null };
  }

  // SD-1 — decided from every OTHER document with the same bytes (the
  // uploaded one already carries its hash and used to match itself), and
  // aware of what became of each: a copy whose capture was rejected does
  // not block a legitimate re-upload, but is still flagged.
  const fileDecision = contentSha256
    ? assessFileHashMatches(documentId, await repo.findSameFileDocuments(companyId, contentSha256))
    : ({ kind: "none" } as const);

  if (fileDecision.kind === "blocked") {
    await repo.updateCaptureAsSystem(companyId, capture.id, {
      status: "Duplicate",
      duplicate_status: "Blocked",
      duplicate_of_capture_id: fileDecision.ofCaptureId,
      duplicate_reason: `This is the same file as “${fileDecision.filename}”, already ${fileDecision.ofCaptureId === null ? "stored" : "captured"}.`,
    });
    await repo.recordSystemCaptureEvent(
      companyId, capture.id, "DuplicateEvaluated",
      { layer: "file-hash", status: "Blocked", priorDocumentId: fileDecision.ofDocumentId, priorCaptureId: fileDecision.ofCaptureId },
      performedBy,
    );
    return {
      captureId: capture.id,
      status: "Duplicate",
      duplicateOfDocumentId: fileDecision.ofDocumentId,
      message: `This file has already been uploaded as “${fileDecision.filename}”. Open that invoice instead of capturing it twice.`,
    };
  }

  await repo.updateCaptureAsSystem(companyId, capture.id, {
    status: "Queued",
    ...(fileDecision.kind === "possible"
      ? {
          duplicate_status: fileDecision.decision.status,
          duplicate_of_capture_id: fileDecision.decision.ofCaptureId,
          duplicate_reason: fileDecision.decision.reason,
        }
      : {}),
  });
  if (fileDecision.kind === "possible") {
    await repo.recordSystemCaptureEvent(
      companyId, capture.id, "DuplicateEvaluated",
      { layer: "file-hash", status: "Possible", priorCaptureId: fileDecision.decision.ofCaptureId },
      performedBy,
    );
  }
  await repo.recordCaptureEvent(companyId, capture.id, "Queued", { documentId });
  return { captureId: capture.id, status: "Queued", duplicateOfDocumentId: null, message: null };
}

// ---------------------------------------------------------------------
// Extraction (runs on the automation runner, never in a request)
// ---------------------------------------------------------------------

export type ExtractionSweepOutcome = {
  attempted: number;
  extracted: number;
  needsReview: number;
  failed: number;
  /** Set when the run stopped early because the provider is unavailable —
   * the circuit's job, not the task's failure. */
  stoppedReason: string | null;
  circuitOpen: boolean;
  dailyCapReached: boolean;
};

/**
 * Extracts every queued capture for one company, within the AI budget.
 *
 * Provider failures stop the batch — exactly as the classification sweep
 * does — because sending the rest into a provider that is already refusing
 * them is how COST's sweep re-asked the same documents every two minutes.
 */
export async function runSupplierInvoiceExtractionSweep(
  companyId: string,
  performedBy: string,
  options: { taskRunId?: number | null; limit?: number; provider?: ExtractionProvider; readDocument: (documentId: number) => Promise<{ bytes: Uint8Array; mimeType: string }> },
): Promise<ExtractionSweepOutcome> {
  // The switch decides, not an import. With it off — which is every
  // environment that has not deliberately set it, including production —
  // this is `UnavailableExtractionProvider` and no request is ever made.
  const provider = options.provider ?? (await selectExtractionProvider());
  const taskRunId = options.taskRunId ?? null;
  const queued = await repo.listCapturesAwaitingExtraction(companyId, options.limit ?? 10);

  const outcome: ExtractionSweepOutcome = {
    attempted: 0,
    extracted: 0,
    needsReview: 0,
    failed: 0,
    stoppedReason: null,
    circuitOpen: false,
    dailyCapReached: false,
  };

  for (const queuedCapture of queued) {
    const gate = await repo.openExtractionGate(companyId, queuedCapture.id);
    if (gate.decision === "circuit_open") {
      outcome.circuitOpen = true;
      outcome.stoppedReason = "PRECISIA AI's provider is unavailable. Extraction will resume automatically.";
      break;
    }
    if (gate.decision === "daily_cap") {
      outcome.dailyCapReached = true;
      outcome.stoppedReason =
        gate.refused_layer === "provider"
          ? "This company has reached its overall daily AI limit. Extraction resumes tomorrow."
          : "Today's invoice-capture AI limit has been reached. Extraction resumes tomorrow.";
      break;
    }

    const claimed = await repo.claimCaptureForExtraction(companyId, queuedCapture.id);
    if (!claimed) {
      // Another runner took it; give the reservation back rather than
      // letting it expire against a document we never looked at.
      await recordAttempt(companyId, queuedCapture.id, taskRunId, 1, "document_error", false, null, null, null, null, null, null, performedBy, "none", gate.decision === "probe");
      continue;
    }

    outcome.attempted += 1;
    const attemptNumber = claimed.extraction_attempts + 1;
    const startedAt = Date.now();
    await repo.recordSystemCaptureEvent(companyId, claimed.id, "ExtractionStarted", { attempt: attemptNumber }, performedBy);

    let document: { bytes: Uint8Array; mimeType: string };
    try {
      document = await options.readDocument(claimed.document_id);
    } catch (error) {
      await failCapture(companyId, claimed.id, "unsupported-document", sanitizeProviderMessage(error), attemptNumber, taskRunId, performedBy, gate.decision === "probe", false);
      outcome.failed += 1;
      continue;
    }

    const answer = await provider.extract({ bytes: document.bytes, mimeType: document.mimeType });
    const durationMs = Date.now() - startedAt;

    if (!answer.ok) {
      const reached = providerWasReached(answer.category);
      await failCapture(companyId, claimed.id, answer.category, answer.message, attemptNumber, taskRunId, performedBy, gate.decision === "probe", reached, answer.httpStatus, answer.model, durationMs);
      outcome.failed += 1;
      const signal = circuitSignalFor(answer.category);
      if (signal === "auth" || signal === "provider_failure" || signal === "rate_limit" || signal === "timeout") {
        outcome.stoppedReason = operatorMessageFor(answer.category);
        break;
      }
      continue;
    }

    const report = validateExtraction(answer.result);
    const retry = shouldRetryExtraction(report, attemptNumber, MAX_EXTRACTION_ATTEMPTS);

    await persistExtraction(companyId, claimed.id, answer.result, report, performedBy);
    await recordAttempt(
      companyId, claimed.id, taskRunId, attemptNumber,
      report.status === "Incomplete" ? "validation_failed" : "extracted",
      true, answer.model, null, null, null, answer.usage as Record<string, unknown> | null, durationMs, performedBy, "success", gate.decision === "probe",
    );

    logExtractionEvent({
      event: "extraction.completed",
      companyId,
      captureId: claimed.id,
      documentId: claimed.document_id,
      attempt: attemptNumber,
      model: answer.model,
      durationMs,
      outcome: report.status,
      lineCount: answer.result.lines.length,
      findingCount: report.findings.length,
    });

    if (retry) {
      // Deterministic failure, attempts remaining: back into the queue.
      await repo.updateCaptureAsSystem(companyId, claimed.id, { status: "Queued", extraction_attempts: attemptNumber });
      await repo.recordSystemCaptureEvent(companyId, claimed.id, "Requeued", { attempt: attemptNumber, reason: "deterministic-validation-failed" }, performedBy);
      continue;
    }

    outcome.extracted += 1;
    if (report.status !== "Pass") outcome.needsReview += 1;
  }

  return outcome;
}

async function persistExtraction(
  companyId: string,
  captureId: number,
  result: ExtractionResult,
  report: ReturnType<typeof validateExtraction>,
  performedBy: string,
): Promise<void> {
  const suppliers = await listSuppliers(companyId);
  const resolution = resolveSupplier(
    {
      supplierName: result.header.supplierName,
      vatNumber: result.header.supplierVatNumber,
      registrationNumber: result.header.supplierRegistrationNumber,
    },
    suppliers,
  );

  const supplierId = resolution.outcome === "resolved" ? resolution.supplierId : null;
  const candidates = resolution.outcome === "resolved" ? [] : resolution.candidates;

  await repo.updateCaptureAsSystem(companyId, captureId, {
    status: "NeedsReview",
    // Phase 5N — persisted so conversion can refuse a credit note
    // structurally, not only because validation happened to flag it.
    document_type: result.header.documentType,
    supplier_name_extracted: result.header.supplierName,
    supplier_vat_number_extracted: result.header.supplierVatNumber,
    supplier_registration_number_extracted: result.header.supplierRegistrationNumber,
    invoice_number: result.header.invoiceNumber,
    invoice_date: result.header.invoiceDate,
    due_date: result.header.dueDate,
    order_reference: result.header.orderReference,
    currency_code: result.header.currencyCode,
    subtotal: result.header.subtotal,
    discount_total: result.header.discountTotal,
    vat_amount: result.header.vatAmount,
    total: result.header.total,
    supplier_id: supplierId,
    supplier_match_tier: resolution.outcome === "resolved" ? resolution.tier : null,
    supplier_candidates: candidates,
    validation_status: report.status,
    validation_findings: report.findings,
    model_confidence: result.header.confidence,
    extraction_attempts: 0,
    last_error_category: null,
    last_error_message: null,
    // SD-1 — the extraction exactly as received, kept apart from the
    // reviewed columns so corrections never erase what was read.
    extraction_snapshot: {
      header: result.header,
      lines: result.lines,
      invoiceNumbersSeen: result.invoiceNumbersSeen,
      declaredLineCount: result.declaredLineCount,
      missingFields: result.missingFields,
      warnings: result.warnings,
    } satisfies ExtractionSnapshot,
    validated_at: new Date().toISOString(),
  });

  await repo.recordSystemCaptureEvent(companyId, captureId, "SupplierResolved", {
    outcome: resolution.outcome,
    tier: resolution.outcome === "resolved" ? resolution.tier : null,
    candidateCount: candidates.length,
  }, performedBy);
  await repo.recordSystemCaptureEvent(companyId, captureId, "ValidationEvaluated", {
    status: report.status,
    findingCount: report.findings.length,
    codes: report.findings.map((f) => f.code),
  }, performedBy);

  const [vatTreatments, learned] = await Promise.all([
    listVatTreatments(companyId),
    supplierId ? repo.listLearnedMappings(companyId, supplierId) : Promise.resolve([]),
  ]);
  const supplier = supplierId ? (suppliers.find((s: { id: number }) => s.id === supplierId) ?? null) : null;

  await repo.replaceCaptureLines(
    companyId,
    captureId,
    result.lines.map((line, index) => {
      const pack = parsePackDescription(line.packDescription ?? line.description);
      const descriptionKey = normaliseDescription(line.description);
      const skuKey = normaliseSku(line.supplierSku);
      const mapping =
        learned.find((m) => m.descriptionNormalised === descriptionKey && m.supplierSkuNormalised === skuKey) ??
        learned.find((m) => m.descriptionNormalised === descriptionKey);

      const suggestionInputs = {
        supplierDefaultGlAccount: supplier?.defaultGlAccount ?? null,
        supplierDefaultVatCode: supplier?.defaultVatCode ?? null,
        learnedGlAccount: mapping?.glAccount ?? null,
        learnedVatCode: mapping?.vatCode ?? null,
        historicalGlAccount: null,
        historicalVatCode: null,
        aiGlAccount: null,
        aiVatCode: null,
        printedVatRatePercent: line.vatRatePercent,
        vatTreatments: vatTreatments.map((t) => ({ code: t.code, rate: t.rate })),
      };
      const gl = suggestGlAccount(suggestionInputs);
      const vat = suggestVatCode(suggestionInputs);

      return {
        line_order: index,
        description: line.description ?? "",
        supplier_sku: line.supplierSku,
        quantity: line.quantity,
        uom: line.uom,
        pack_description: line.packDescription ?? pack.packDescription,
        pack_quantity: line.packQuantity ?? pack.packQuantity,
        unit_price: line.unitPrice,
        discount: line.discount,
        vat_rate_percent: line.vatRatePercent,
        vat_amount: line.vatAmount,
        line_total: line.lineTotal,
        gl_account_suggested: gl.value,
        gl_account_source: gl.source,
        vat_code_suggested: vat.value,
        vat_code_source: vat.source,
        gl_account_confirmed: null,
        vat_code_confirmed: null,
        is_excluded: false,
        line_confidence: line.confidence,
      };
    }),
  );

  await evaluateDuplicate(companyId, captureId, performedBy);
}

async function failCapture(
  companyId: string,
  captureId: number,
  category: string,
  rawMessage: string,
  attemptNumber: number,
  taskRunId: number | null,
  performedBy: string,
  probe: boolean,
  providerReached: boolean,
  httpStatus: number | null = null,
  model: string | null = null,
  durationMs: number | null = null,
): Promise<void> {
  const message = operatorMessageFor(category as never);
  const terminal = attemptNumber >= MAX_EXTRACTION_ATTEMPTS;
  await repo.updateCaptureAsSystem(companyId, captureId, {
    status: terminal ? "Failed" : "Queued",
    extraction_attempts: attemptNumber,
    last_error_category: category,
    last_error_message: message,
  });
  await repo.recordSystemCaptureEvent(companyId, captureId, "ExtractionFailed", { attempt: attemptNumber, category, terminal }, performedBy);
  await recordAttempt(
    companyId, captureId, taskRunId, attemptNumber,
    providerReached ? "provider_error" : "document_error",
    providerReached, model, category, httpStatus,
    // Already sanitised at the provider boundary; sanitised again here
    // because this function is also reachable from a thrown error.
    sanitizeProviderMessage(rawMessage), null, durationMs, performedBy,
    circuitSignalFor(category as never), probe,
  );
  logExtractionEvent({
    event: "extraction.failed",
    companyId,
    captureId,
    attempt: attemptNumber,
    errorCategory: category as never,
    httpStatus,
    message,
  });
}

async function recordAttempt(
  companyId: string,
  captureId: number,
  taskRunId: number | null,
  attemptNumber: number,
  outcome: "extracted" | "validation_failed" | "invalid_response" | "provider_error" | "document_error" | "write_error",
  providerRequestMade: boolean,
  model: string | null,
  errorCategory: string | null,
  httpStatus: number | null,
  providerMessage: string | null,
  usage: Record<string, unknown> | null,
  durationMs: number | null,
  performedBy: string,
  circuitSignal: "success" | "auth" | "timeout" | "provider_failure" | "rate_limit" | "none",
  probe: boolean,
): Promise<void> {
  await repo.recordExtractionAttempt({
    companyId, captureId, taskRunId, attemptNumber, outcome, providerRequestMade, model,
    errorCategory, httpStatus, providerMessage, usage, durationMs, performedBy, circuitSignal, probe,
  });
}

// ---------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------

/** Re-runs the duplicate check. Called after extraction and again whenever
 * the supplier or invoice number changes during review — the verdict must
 * reflect what the reviewer has actually settled on. */
export async function evaluateDuplicate(companyId: string, captureId: number, performedBy: string): Promise<void> {
  // SD-1 — read as the system: the verdict must not depend on what the
  // current user happens to be allowed to see.
  const capture = await repo.getCaptureAsSystem(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  const contentSha256 = await repo.getDocumentHashAsSystem(companyId, capture.document_id);

  const [captures, bills] = await Promise.all([
    repo.listDuplicateCandidates(companyId, { supplierId: capture.supplier_id, contentSha256 }),
    capture.supplier_id ? repo.listBillDuplicateCandidates(companyId, capture.supplier_id) : Promise.resolve([]),
  ]);

  const decision = assessDuplicate(
    {
      captureId,
      supplierId: capture.supplier_id,
      invoiceNumber: capture.invoice_number,
      invoiceDate: capture.invoice_date,
      total: capture.total === null ? null : Number(capture.total),
      contentSha256,
    },
    captures,
    bills,
  );

  await repo.updateCaptureAsSystem(companyId, captureId, {
    duplicate_status: decision.status,
    duplicate_of_capture_id: decision.ofCaptureId,
    duplicate_of_bill_id: decision.ofBillId,
    duplicate_reason: decision.reason,
  });
  await repo.recordSystemCaptureEvent(companyId, captureId, "DuplicateEvaluated", { status: decision.status, layer: decision.layer }, performedBy);
}

export type HeaderCorrection = Partial<{
  supplierId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  orderReference: string | null;
  /** SD-1 — the reviewed figures printed on the document. */
  documentType: "Invoice" | "Credit Note" | "Debit Note" | "Other" | null;
  currencyCode: string | null;
  subtotal: number | null;
  discountTotal: number | null;
  vatAmount: number | null;
  total: number | null;
}>;

const EDITABLE_STATUSES = new Set(["NeedsReview", "ManualEntry"]);

function requireEditable(capture: repo.CaptureRow): void {
  if (!EDITABLE_STATUSES.has(capture.status)) {
    throw new ValidationError(`This invoice cannot be edited (it is ${capture.status}).`);
  }
}

function moneyOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number.`);
  return Math.round(n * 100) / 100;
}

/** Applies a reviewer's header corrections, then re-checks duplicates and
 * re-validates. Every changed field is recorded by NAME — never with its
 * value, which would put invoice content into the audit trail; the values
 * as extracted remain in `extraction_snapshot`, the values as corrected in
 * the capture itself. */
export async function applyHeaderCorrection(companyId: string, captureId: number, correction: HeaderCorrection): Promise<void> {
  const performedBy = await getPerformedByLabel();
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  requireEditable(capture);

  const fields: Record<string, unknown> = {};
  if ("supplierId" in correction) {
    fields.supplier_id = correction.supplierId;
    fields.supplier_match_tier = correction.supplierId ? "manual" : null;
  }
  if ("invoiceNumber" in correction) fields.invoice_number = correction.invoiceNumber?.trim() || null;
  if ("invoiceDate" in correction) fields.invoice_date = correction.invoiceDate || null;
  if ("dueDate" in correction) fields.due_date = correction.dueDate || null;
  if ("orderReference" in correction) fields.order_reference = correction.orderReference?.trim() || null;
  if ("documentType" in correction) {
    const type = correction.documentType ?? null;
    if (type !== null && !["Invoice", "Credit Note", "Debit Note", "Other"].includes(type)) {
      throw new ValidationError("Document type must be Invoice, Credit Note, Debit Note or Other.");
    }
    fields.document_type = type;
  }
  if ("currencyCode" in correction) fields.currency_code = correction.currencyCode?.trim().toUpperCase() || null;
  if ("subtotal" in correction) fields.subtotal = moneyOrNull(correction.subtotal, "Subtotal");
  if ("discountTotal" in correction) fields.discount_total = moneyOrNull(correction.discountTotal, "Discount");
  if ("vatAmount" in correction) fields.vat_amount = moneyOrNull(correction.vatAmount, "VAT");
  if ("total" in correction) fields.total = moneyOrNull(correction.total, "Total");
  if (Object.keys(fields).length === 0) return;

  await repo.updateCaptureAsReviewer(companyId, captureId, fields);
  await repo.recordCaptureEvent(companyId, captureId, "FieldCorrected", { fields: Object.keys(correction) });

  await evaluateDuplicate(companyId, captureId, performedBy);
  await revalidateCapture(companyId, captureId, performedBy);
}

export type LineCorrection = {
  lineOrder: number;
  description?: string;
  supplierSku?: string | null;
  quantity?: number | null;
  uom?: string | null;
  unitPrice?: number | null;
  discount?: number | null;
  vatRatePercent?: number | null;
  vatAmount?: number | null;
  lineTotal?: number | null;
  glAccount?: string | null;
  vatCode?: string | null;
  isExcluded?: boolean;
};

export type NewLine = Omit<LineCorrection, "lineOrder" | "isExcluded">;

function lineFields(line: Omit<LineCorrection, "lineOrder">): repo.ReviewerLineFields {
  const fields: repo.ReviewerLineFields = {};
  if (line.description !== undefined) fields.description = line.description ?? "";
  if (line.supplierSku !== undefined) fields.supplier_sku = line.supplierSku;
  if (line.quantity !== undefined) fields.quantity = line.quantity;
  if (line.uom !== undefined) fields.uom = line.uom;
  if (line.unitPrice !== undefined) fields.unit_price = line.unitPrice;
  if (line.discount !== undefined) fields.discount = line.discount;
  if (line.vatRatePercent !== undefined) fields.vat_rate_percent = line.vatRatePercent;
  if (line.vatAmount !== undefined) fields.vat_amount = line.vatAmount;
  if (line.lineTotal !== undefined) fields.line_total = line.lineTotal;
  if (line.glAccount !== undefined) fields.gl_account_confirmed = line.glAccount;
  if (line.vatCode !== undefined) fields.vat_code_confirmed = line.vatCode;
  if (line.isExcluded !== undefined) fields.is_excluded = line.isExcluded;
  return fields;
}

/** Corrects, adds and removes lines, then re-validates. */
export async function applyLineCorrections(
  companyId: string,
  captureId: number,
  corrections: LineCorrection[],
  changes: { add?: NewLine[]; remove?: number[] } = {},
): Promise<void> {
  const performedBy = await getPerformedByLabel();
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  requireEditable(capture);

  for (const correction of corrections) {
    const fields = lineFields(correction);
    if (Object.keys(fields).length === 0) continue;
    await repo.updateCaptureLine(companyId, captureId, correction.lineOrder, fields);
  }
  for (const lineOrder of changes.remove ?? []) {
    await repo.removeCaptureLineAsReviewer(companyId, captureId, lineOrder);
  }
  if (changes.add && changes.add.length > 0) {
    await repo.addCaptureLinesAsReviewer(companyId, captureId, changes.add.map((line) => lineFields(line)));
  }

  await repo.recordCaptureEvent(companyId, captureId, "FieldCorrected", {
    lines: corrections.map((c) => c.lineOrder),
    added: changes.add?.length ?? 0,
    removed: changes.remove ?? [],
  });
  await revalidateCapture(companyId, captureId, performedBy);
}

/**
 * SD-1 — enter an invoice by hand from the original document.
 *
 * For a capture nothing will extract: live AI is off, or extraction failed.
 * The original document stays attached and viewable; the reviewer types the
 * header and lines, then submits it for review, where it is validated and
 * duplicate-checked exactly like an extracted one.
 */
export async function startManualEntry(companyId: string, captureId: number): Promise<void> {
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  if (capture.status !== "Queued" && capture.status !== "Failed") {
    throw new ValidationError(`Only an invoice waiting for extraction, or one whose extraction failed, can be entered by hand (this one is ${capture.status}).`);
  }
  await repo.updateCaptureAsReviewer(companyId, captureId, { status: "ManualEntry" });
  await repo.recordCaptureEvent(companyId, captureId, "ManualEntryStarted", { from: capture.status });
}

/** Moves a manual entry into review, then checks it. */
export async function submitForReview(companyId: string, captureId: number): Promise<void> {
  const performedBy = await getPerformedByLabel();
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  if (capture.status !== "ManualEntry") {
    throw new ValidationError(`Only an invoice being entered by hand can be submitted for review (this one is ${capture.status}).`);
  }
  await repo.updateCaptureAsReviewer(companyId, captureId, { status: "NeedsReview" });
  await repo.recordCaptureEvent(companyId, captureId, "SubmittedForReview", {});
  await evaluateDuplicate(companyId, captureId, performedBy);
  await revalidateCapture(companyId, captureId, performedBy);
}

/**
 * SD-1 — validates the capture as it stands now (reviewed header, kept
 * lines), with the same deterministic checks extraction uses.
 *
 * The verdict is written only if the capture has not changed since it was
 * read, so it is always a verdict about the values it describes. Returns
 * the status written, or "Pending" when a concurrent edit got there first
 * (the capture then stays Pending, which blocks conversion until validated).
 */
export async function revalidateCapture(companyId: string, captureId: number, performedBy: string): Promise<ValidationStatus> {
  const capture = await repo.getCaptureAsSystem(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  if (!EDITABLE_STATUSES.has(capture.status)) return capture.validation_status;

  const [lines, suppliers, vatTreatments] = await Promise.all([
    repo.listCaptureLinesAsSystem(companyId, captureId),
    capture.supplier_id ? listSuppliers(companyId) : Promise.resolve([]),
    listVatTreatments(companyId),
  ]);
  const rateByCode = new Map(vatTreatments.map((t) => [t.code, Number(t.rate)]));
  const supplier = capture.supplier_id ? (suppliers.find((s: { id: number }) => s.id === capture.supplier_id) as { name?: string } | undefined) : undefined;

  const reviewed = buildReviewedExtraction(
    {
      documentType: capture.document_type,
      supplierName: supplier?.name ?? capture.supplier_name_extracted,
      supplierVatNumber: capture.supplier_vat_number_extracted,
      supplierRegistrationNumber: capture.supplier_registration_number_extracted,
      invoiceNumber: capture.invoice_number,
      invoiceDate: capture.invoice_date,
      dueDate: capture.due_date,
      orderReference: capture.order_reference,
      currencyCode: capture.currency_code,
      subtotal: numberOrNull(capture.subtotal),
      discountTotal: numberOrNull(capture.discount_total),
      vatAmount: numberOrNull(capture.vat_amount),
      total: numberOrNull(capture.total),
    },
    lines.map((l) => ({
      description: l.description,
      supplierSku: l.supplier_sku,
      quantity: numberOrNull(l.quantity),
      uom: l.uom,
      unitPrice: numberOrNull(l.unit_price),
      discount: numberOrNull(l.discount),
      vatRatePercent: numberOrNull(l.vat_rate_percent),
      vatAmount: numberOrNull(l.vat_amount),
      lineTotal: numberOrNull(l.line_total),
      isExcluded: l.is_excluded,
      vatCodeRatePercent: rateByCode.get(l.vat_code_confirmed ?? l.vat_code_suggested ?? "") ?? null,
    })),
    readExtractionSnapshot(capture.extraction_snapshot),
  );
  const report = validateExtraction(reviewed);

  const written = await repo.updateCaptureAsSystemIfUnchanged(companyId, captureId, capture.updated_at, {
    validation_status: report.status,
    validation_findings: report.findings,
    validated_at: new Date().toISOString(),
  });
  if (!written) return "Pending";

  await repo.recordSystemCaptureEvent(companyId, captureId, "ValidationEvaluated", {
    basis: "review",
    status: report.status,
    findingCount: report.findings.length,
    codes: report.findings.map((f) => f.code),
  }, performedBy);
  return report.status;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function cancelCapture(companyId: string, captureId: number): Promise<void> {
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  if (capture.bill_id) throw new ValidationError(`This invoice has already become bill #${capture.bill_id} and cannot be discarded.`);
  await repo.updateCaptureAsReviewer(companyId, captureId, { status: "Cancelled" });
  await repo.recordCaptureEvent(companyId, captureId, "Cancelled", {});
}

// ---------------------------------------------------------------------
// Conversion — the accounting boundary
// ---------------------------------------------------------------------

type PreparedConversion = { input: CreatePurchaseBillInput; approvalAmount: number; lines: repo.CaptureLineRow[]; capture: repo.CaptureRow };

async function buildConversion(companyId: string, captureId: number): Promise<PreparedConversion> {
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);

  const lines = await repo.listCaptureLines(companyId, captureId);
  const conversionLines: ConversionLine[] = lines.map((line) => ({
    lineOrder: line.line_order,
    description: line.description,
    quantity: line.quantity === null ? null : Number(line.quantity),
    unitPrice: line.unit_price === null ? null : Number(line.unit_price),
    discount: line.discount === null ? null : Number(line.discount),
    glAccount: line.gl_account_confirmed ?? line.gl_account_suggested,
    vatCode: line.vat_code_confirmed ?? line.vat_code_suggested,
    isExcluded: line.is_excluded,
  }));

  // Phase 5N — the company's own currency, needed because "is this
  // invoice foreign?" is a question about the pair, not about the printed
  // code alone. A company with no base currency recorded is treated as
  // ZAR, which is what every other reader of this field does
  // (`report-centre/production-source.ts`).
  const company = await getCompany(companyId);
  const baseCurrencyCode = company?.baseCurrencyCode?.trim() || "ZAR";

  const assessment = assessConversion({
    captureId,
    status: capture.status,
    documentType: capture.document_type,
    currencyCode: capture.currency_code,
    baseCurrencyCode,
    supplierId: capture.supplier_id,
    invoiceNumber: capture.invoice_number,
    invoiceDate: capture.invoice_date,
    dueDate: capture.due_date,
    validationStatus: capture.validation_status,
    duplicate: { status: capture.duplicate_status, reason: capture.duplicate_reason },
    existingBillId: capture.bill_id,
    lines: conversionLines,
  });

  if (!assessment.ok) {
    throw new ValidationError(assessment.blocks.map((b) => b.message).join(" "));
  }

  // SD-1 — the approval amount is what the purchase-bill engine itself will
  // compute for these reviewed lines (never the extracted header total,
  // which a missing value used to turn into 0), raised to the reviewed
  // printed total when that is larger.
  let approvalAmount: number;
  try {
    const totals = await previewPurchaseBillTotals(companyId, assessment.input.lines ?? []);
    approvalAmount = conversionApprovalAmount(totals.total, numberOrNull(capture.total));
  } catch (error) {
    // No computable amount means no approval check is possible: refuse.
    if (error instanceof BillValidationError || error instanceof Error) throw new ValidationError(error.message);
    throw error;
  }

  return { input: assessment.input, approvalAmount, lines, capture };
}

/**
 * SD-1 — everything conversion would do, short of doing it: every refusal
 * reason, and the amount the reviewer's approval limit must cover. The
 * route checks the limit against this amount before converting.
 */
export async function prepareConversion(companyId: string, captureId: number): Promise<{ approvalAmount: number; documentType: "Bill" | "Credit Note" }> {
  const prepared = await buildConversion(companyId, captureId);
  return { approvalAmount: prepared.approvalAmount, documentType: prepared.input.documentType === "Credit Note" ? "Credit Note" : "Bill" };
}

/**
 * Converts a reviewed capture into a DRAFT purchase document — a supplier
 * Bill, or (SD-1) a supplier Credit Note.
 *
 * The permission and approval-limit checks live at the route, as they do
 * for every other purchasing action; `approvedAmount` is the amount that
 * check was made against. If the capture now converts to MORE than that
 * (it was corrected in between), this refuses, so a limit can never be
 * checked against one figure and a larger one booked.
 *
 * Idempotent: a capture that already has a bill is refused by
 * `assessConversion`, and `supplier_invoice_captures_bill_unique` makes a
 * concurrent second conversion impossible at the database. The guard in
 * 0112 additionally only accepts the very Draft document created here.
 */
export async function convertCaptureToBill(companyId: string, captureId: number, approvedAmount: number): Promise<{ billId: number }> {
  const performedBy = await getPerformedByLabel();
  const prepared = await buildConversion(companyId, captureId);
  if (!(Number.isFinite(approvedAmount) && prepared.approvalAmount <= approvedAmount + 0.005)) {
    throw new ValidationError("This invoice changed after its approval was checked. Convert it again.");
  }

  // The existing purchasing service owns every figure from here.
  const bill = await createPurchaseBill(companyId, prepared.input);

  try {
    await repo.updateCaptureAsReviewer(companyId, captureId, {
      status: "Converted",
      bill_id: bill.id,
      // Both are set by the database from the session and its clock (0111).
      converted_at: new Date().toISOString(),
      converted_by: performedBy,
    });
  } catch (error) {
    // The Draft was created but could not be linked. Cancel it through the
    // ordinary bill workflow (Draft -> Cancelled, no journal exists) rather
    // than leave an unlinked document a second conversion would duplicate.
    try {
      await cancelBill(companyId, bill.id);
    } catch {
      // Cancelling is best effort; the error that matters is the original.
    }
    throw error;
  }
  await repo.recordCaptureEvent(companyId, captureId, "ConvertedToBill", {
    billId: bill.id,
    documentType: prepared.input.documentType ?? "Bill",
    lineCount: prepared.input.lines?.length ?? 0,
  });

  await learnFromConversion(companyId, captureId, prepared.capture.supplier_id!, prepared.lines, performedBy);

  return { billId: bill.id };
}

/**
 * Learning, from a HUMAN-APPROVED conversion only.
 *
 * Failures are recorded as an audit event rather than swallowed — COST
 * logged a `console.warn` and reported the approval as successful, so a
 * silently broken learning system looked healthy.
 */
async function learnFromConversion(
  companyId: string,
  captureId: number,
  supplierId: number,
  lines: repo.CaptureLineRow[],
  performedBy: string,
): Promise<void> {
  for (const line of lines) {
    if (line.is_excluded) continue;
    const glAccount = line.gl_account_confirmed ?? line.gl_account_suggested;
    const vatCode = line.vat_code_confirmed ?? line.vat_code_suggested;
    if (!glAccount || !vatCode) continue;
    try {
      await repo.upsertLearnedMapping(companyId, supplierId, {
        descriptionNormalised: normaliseDescription(line.description),
        supplierSkuNormalised: normaliseSku(line.supplier_sku),
        glAccount,
        vatCode,
        captureId,
      });
    } catch (error) {
      await repo.recordSystemCaptureEvent(
        companyId, captureId, "FieldCorrected",
        { learningFailed: true, lineOrder: line.line_order, reason: sanitizeProviderMessage(error) },
        performedBy,
      );
    }
  }
}

export const getCapture = repo.getCapture;
export const listCaptures = repo.listCaptures;
export const listCaptureLines = repo.listCaptureLines;
export const listCaptureEvents = repo.listCaptureEvents;

// ---------------------------------------------------------------------
// SD-2 — what the Supplier Documents screens read
// ---------------------------------------------------------------------

export type InboxCapture = {
  capture: repo.CaptureRow;
  bill: repo.CaptureBillSummary | null;
  document: repo.CaptureDocumentSummary | null;
};

/** The Invoice Capture inbox: every capture (newest first, bounded), with the
 * purchase document each became and its original file's name. */
export async function listInboxCaptures(companyId: string, limit = 500): Promise<InboxCapture[]> {
  const captures = await repo.listCaptures(companyId, { status: "All", limit });
  const billIds = captures.map((c) => c.bill_id).filter((id): id is number => id !== null);
  const [bills, documents] = await Promise.all([
    repo.listBillSummaries(companyId, billIds),
    repo.listDocumentSummaries(companyId, captures.map((c) => c.document_id)),
  ]);
  const billById = new Map(bills.map((b) => [b.id, b]));
  const documentById = new Map(documents.map((d) => [d.id, d]));
  return captures.map((capture) => ({
    capture,
    bill: capture.bill_id !== null ? (billById.get(capture.bill_id) ?? null) : null,
    document: documentById.get(capture.document_id) ?? null,
  }));
}

export type CaptureReview = InboxCapture & {
  lines: repo.CaptureLineRow[];
  events: repo.CaptureEventRow[];
};

/** Everything the review screen shows for one capture, or null. */
export async function getCaptureReview(companyId: string, captureId: number): Promise<CaptureReview | null> {
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) return null;
  const [lines, events, bills, documents] = await Promise.all([
    repo.listCaptureLines(companyId, captureId),
    repo.listCaptureEvents(companyId, captureId),
    repo.listBillSummaries(companyId, capture.bill_id !== null ? [capture.bill_id] : []),
    repo.listDocumentSummaries(companyId, [capture.document_id]),
  ]);
  return { capture, lines, events, bill: bills[0] ?? null, document: documents[0] ?? null };
}
