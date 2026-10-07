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
import { createPurchaseBill } from "@/server/services/purchase-bill-service";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { assessConversion, type ConversionLine } from "@/server/supplier-invoice-capture/conversion";
import { assessDuplicate } from "@/server/supplier-invoice-capture/duplicate-detection";
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
import type { ExtractionResult } from "@/server/supplier-invoice-capture/types";

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

  if (contentSha256) {
    const priorDocument = await repo.findDocumentByHash(companyId, contentSha256);
    if (priorDocument && priorDocument.id !== documentId) {
      await repo.updateCaptureAsSystem(companyId, capture.id, {
        status: "Duplicate",
        duplicate_status: "Blocked",
        duplicate_reason: `This is the same file as “${priorDocument.filename}”, already captured.`,
      });
      await repo.recordSystemCaptureEvent(companyId, capture.id, "DuplicateEvaluated", { layer: "file-hash", priorDocumentId: priorDocument.id }, performedBy);
      return {
        captureId: capture.id,
        status: "Duplicate",
        duplicateOfDocumentId: priorDocument.id,
        message: `This file has already been uploaded as “${priorDocument.filename}”. Open that invoice instead of capturing it twice.`,
      };
    }
  }

  await repo.updateCaptureAsSystem(companyId, capture.id, { status: "Queued" });
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
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);

  const [captures, bills] = await Promise.all([
    repo.listDuplicateCandidates(companyId),
    capture.supplier_id ? repo.listBillDuplicateCandidates(companyId, capture.supplier_id) : Promise.resolve([]),
  ]);
  const self = captures.find((c) => c.captureId === captureId);

  const decision = assessDuplicate(
    {
      captureId,
      supplierId: capture.supplier_id,
      invoiceNumber: capture.invoice_number,
      invoiceDate: capture.invoice_date,
      total: capture.total === null ? null : Number(capture.total),
      contentSha256: self?.contentSha256 ?? null,
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
}>;

/** Applies a reviewer's header corrections and re-evaluates anything that
 * depends on them. Every changed field is recorded by NAME — never with its
 * value, which would put invoice content into the audit trail. */
export async function applyHeaderCorrection(companyId: string, captureId: number, correction: HeaderCorrection): Promise<void> {
  const performedBy = await getPerformedByLabel();
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  if (capture.status !== "NeedsReview") throw new ValidationError(`This invoice cannot be edited (it is ${capture.status}).`);

  const fields: Record<string, unknown> = {};
  if ("supplierId" in correction) {
    fields.supplier_id = correction.supplierId;
    fields.supplier_match_tier = correction.supplierId ? "manual" : null;
  }
  if ("invoiceNumber" in correction) fields.invoice_number = correction.invoiceNumber;
  if ("invoiceDate" in correction) fields.invoice_date = correction.invoiceDate;
  if ("dueDate" in correction) fields.due_date = correction.dueDate;
  if ("orderReference" in correction) fields.order_reference = correction.orderReference;
  if (Object.keys(fields).length === 0) return;

  await repo.updateCaptureAsReviewer(companyId, captureId, fields);
  await repo.recordCaptureEvent(companyId, captureId, "FieldCorrected", { fields: Object.keys(correction) });

  if ("supplierId" in correction || "invoiceNumber" in correction || "invoiceDate" in correction) {
    await evaluateDuplicate(companyId, captureId, performedBy);
  }
}

export type LineCorrection = {
  lineOrder: number;
  description?: string;
  quantity?: number | null;
  unitPrice?: number | null;
  discount?: number | null;
  glAccount?: string | null;
  vatCode?: string | null;
  isExcluded?: boolean;
};

export async function applyLineCorrections(companyId: string, captureId: number, corrections: LineCorrection[]): Promise<void> {
  const capture = await repo.getCapture(companyId, captureId);
  if (!capture) throw new NotFoundError(`No capture with id ${captureId}.`);
  if (capture.status !== "NeedsReview") throw new ValidationError(`This invoice cannot be edited (it is ${capture.status}).`);

  for (const correction of corrections) {
    const fields: Record<string, unknown> = {};
    if (correction.description !== undefined) fields.description = correction.description;
    if (correction.quantity !== undefined) fields.quantity = correction.quantity;
    if (correction.unitPrice !== undefined) fields.unit_price = correction.unitPrice;
    if (correction.discount !== undefined) fields.discount = correction.discount;
    if (correction.glAccount !== undefined) fields.gl_account_confirmed = correction.glAccount;
    if (correction.vatCode !== undefined) fields.vat_code_confirmed = correction.vatCode;
    if (correction.isExcluded !== undefined) fields.is_excluded = correction.isExcluded;
    if (Object.keys(fields).length === 0) continue;
    await repo.updateCaptureLine(companyId, captureId, correction.lineOrder, fields);
  }
  await repo.recordCaptureEvent(companyId, captureId, "FieldCorrected", { lines: corrections.map((c) => c.lineOrder) });
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

/**
 * Converts a reviewed capture into a DRAFT purchase bill.
 *
 * The permission and approval-limit checks live at the route, as they do
 * for every other purchasing action. This function refuses on its own terms
 * as well: `assessConversion` takes one argument and there is no parameter
 * on this function through which any of its blocks could be waived.
 *
 * Idempotent: a capture that already has a bill is refused by
 * `assessConversion`, and `supplier_invoice_captures_bill_unique` makes a
 * concurrent second conversion impossible at the database.
 */
export async function convertCaptureToBill(companyId: string, captureId: number): Promise<{ billId: number }> {
  const performedBy = await getPerformedByLabel();
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

  // The existing purchasing service owns every figure from here.
  const bill = await createPurchaseBill(companyId, assessment.input);

  await repo.updateCaptureAsReviewer(companyId, captureId, {
    status: "Converted",
    bill_id: bill.id,
    converted_at: new Date().toISOString(),
    converted_by: performedBy,
  });
  await repo.recordCaptureEvent(companyId, captureId, "ConvertedToBill", { billId: bill.id, lineCount: assessment.input.lines?.length ?? 0 });

  await learnFromConversion(companyId, captureId, capture.supplier_id!, lines, performedBy);

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
