/**
 * Phase 5L — the AI provider boundary for invoice extraction.
 *
 * An INTERFACE with a deterministic default, mirroring the pattern
 * `documents/ocr-provider.ts` and `virus-scanner.ts` already establish in
 * this codebase: one injection point, an honest no-op default that never
 * fabricates, and a real implementation wired in at the service.
 *
 * Two things this deliberately does NOT do, both learned from VYRON COST:
 *
 *  1. **It does not hand-roll `fetch`.** COST's two production engines
 *     bypassed their SDK and called the provider directly, which is how
 *     they ended up with no request timeout, no `Retry-After` handling and
 *     no backoff. This goes through the existing gateway provider, which
 *     has all three and a typed error taxonomy.
 *  2. **It does not return, log or store the provider's raw answer.** The
 *     boundary's contract is a parsed `ExtractionResult` or a typed error
 *     category — a caller cannot obtain the transcript, because nothing
 *     hands it one.
 *
 * SCANNED INVOICES ARE NOT A MANUAL-ONLY WORKFLOW (owner decision,
 * SD-3A review, 2026-10-07). Supplier invoices and credit notes stay
 * eligible for AUTOMATIC extraction whatever the source: a text PDF, a
 * scanned PDF with no text layer, a JPEG or a PNG. This boundary sends the
 * document itself (file/image part) to an OCR/vision-capable provider — it
 * must never be changed to require a text layer, or to route scanned
 * invoices to manual entry because the PDF has no text. Manual entry is a
 * fallback (provider off, failed or unreadable), not the path for scans.
 * Live AI is OFF; when it is enabled, the deterministic application stays
 * the authority for arithmetic, VAT, duplicates, approval limits,
 * validation, conversion and posting — extraction only transcribes.
 * (Supplier STATEMENTS are different: SD-3 starts their scanned path with
 * manual entry because no statement OCR exists yet — see
 * docs/SUPPLIER_DOCUMENT_INTELLIGENCE_SD3A_DESIGN.md. That decision does
 * not apply here.)
 */

import { classifyProviderError, DEFAULT_MODEL } from "@/server/ai/providers/gateway-provider";
import { AIProviderError } from "@/server/ai/types";
import { sanitizeProviderMessage } from "./redaction";
import type {
  ExtractionErrorCategory,
  ExtractionInput,
  ExtractionProviderResult,
  ExtractionResult,
} from "./types";

export interface ExtractionProvider {
  /** Reads a supplier invoice. Never throws for a provider failure — a
   * failure is a typed result, so a caller cannot accidentally log an
   * exception carrying a payload. */
  extract(input: ExtractionInput): Promise<ExtractionProviderResult>;
}

/**
 * The honest default. Extracts nothing and says so.
 *
 * `documents/ocr-provider.ts` makes the same choice and states the reason:
 * *"never fabricates extracted text/fields"*. An environment with no AI
 * configured captures the document and lets a person type it, which is a
 * working product, rather than inventing an invoice.
 */
export class UnavailableExtractionProvider implements ExtractionProvider {
  async extract(): Promise<ExtractionProviderResult> {
    return {
      ok: false,
      category: "missing-api-key",
      httpStatus: null,
      message: "VYRON AI is not configured in this environment.",
      model: null,
    };
  }
}

/**
 * A deterministic provider for tests and the local corpus.
 *
 * Every certification fixture in `test-corpus.ts` runs through this, so the
 * whole pipeline — validation, resolution, duplicates, suggestions,
 * conversion — is exercised end to end with no network, no billing and no
 * flakiness. Phase 5L is tested this way ON PURPOSE: the AI Gateway circuit
 * is OPEN following an HTTP 402 and must not be probed.
 */
export class FixtureExtractionProvider implements ExtractionProvider {
  constructor(private readonly responses: Map<string, ExtractionProviderResult>, private readonly key: (input: ExtractionInput) => string) {}

  async extract(input: ExtractionInput): Promise<ExtractionProviderResult> {
    const found = this.responses.get(this.key(input));
    if (!found) {
      return { ok: false, category: "unsupported-document", httpStatus: null, message: "No fixture for this document.", model: "fixture" };
    }
    return found;
  }
}

/** Maps the gateway's error vocabulary onto this feature's. They are
 * deliberately the same words where they overlap, so operations can read
 * classification and extraction failures side by side. */
export function toExtractionErrorCategory(error: AIProviderError): ExtractionErrorCategory {
  const byStatus: Record<number, ExtractionErrorCategory> = {
    401: "unauthorized",
    402: "payment-required",
    403: "forbidden",
    429: "rate-limit",
  };
  if (error.httpStatus && byStatus[error.httpStatus]) return byStatus[error.httpStatus];
  if (error.httpStatus && error.httpStatus >= 500) return "server-error";

  const byCode: Record<string, ExtractionErrorCategory> = {
    "missing-api-key": "missing-api-key",
    timeout: "timeout",
    "rate-limit": "rate-limit",
    "malformed-response": "malformed-response",
    "provider-error": "provider-error",
  };
  return byCode[error.code] ?? "unknown";
}

/** The circuit signal this failure should produce, using exactly the
 * vocabulary `fn_ai_extraction_record_attempt` accepts. Auth-class failures
 * open the circuit immediately — which is why the Gateway's current 402 has
 * it open, and why this feature must not be the thing that closes it. */
export function circuitSignalFor(category: ExtractionErrorCategory): "auth" | "timeout" | "rate_limit" | "provider_failure" | "none" {
  switch (category) {
    case "missing-api-key":
    case "unauthorized":
    case "payment-required":
    case "forbidden":
    case "configuration":
      return "auth";
    case "timeout":
      return "timeout";
    case "rate-limit":
      return "rate_limit";
    case "server-error":
    case "provider-error":
    case "network":
      return "provider_failure";
    // A malformed answer means the provider DID respond — that is a
    // document outcome, not an outage. 0099 draws the same line.
    case "malformed-response":
    case "unsupported-document":
    case "unknown":
      return "none";
  }
}

/** Whether a provider request was actually made. Drives the reservation
 * give-back: a failure that never reached the provider must not consume
 * budget. */
export function providerWasReached(category: ExtractionErrorCategory): boolean {
  return category !== "missing-api-key" && category !== "configuration" && category !== "unsupported-document";
}

/**
 * Turns an unknown thrown value into this feature's typed failure.
 *
 * The provider's own text goes through `sanitizeProviderMessage` here, at
 * the boundary — so nothing downstream ever holds an unsanitised string.
 */
export function toProviderFailure(error: unknown, model: string | null): Extract<ExtractionProviderResult, { ok: false }> {
  const classified = error instanceof AIProviderError ? error : classifyProviderError(error);
  const category = toExtractionErrorCategory(classified);
  return {
    ok: false,
    category,
    httpStatus: classified.httpStatus,
    message: sanitizeProviderMessage(classified.providerMessage ?? classified.message),
    model,
  };
}

/**
 * The extraction instruction.
 *
 * Exported so it can be inspected and reviewed like any other artefact
 * rather than buried in a request body. Adapted from COST's V2 prompt,
 * which was rewritten after a weight column printed between UNIT PRICE and
 * V.A.T. was read as money on every row of a real invoice.
 *
 * The two rules that matter are the first and the last: name the columns
 * before reading any value, and never compute anything.
 */
export const EXTRACTION_INSTRUCTION = `You are reading a supplier invoice. Read only what is printed on it.

STEP 1 — COLUMNS
Read the line-item table's column headings, left to right, exactly as printed.
Then say which printed heading each value will be taken from. If no printed
column clearly corresponds to a field, return null for that field. Never guess.

This table may contain numeric columns that are NOT money — a weight, a pack
size, a discount percentage, a tax code. Never place such a column into
unitPrice, vatAmount or lineTotal.

STEP 2 — ROWS
Return every charged product or service row, reading each value ONLY from the
column you named in STEP 1.

Copy the characters exactly as printed. Do NOT calculate, infer, derive,
estimate or convert anything. Do not compute VAT from a rate. Do not derive a
line total from a quantity and a price. Do not total the invoice. If a value
cannot be read, return null for it — never a plausible substitute, and never a
placeholder string.

Do not return headings, subtotals, totals, carried-forward lines or comments as
line items. Report how many charged rows you can see as declaredLineCount.

STEP 3 — HEADER
State what KIND of document this is in documentType: "Invoice", "Credit
Note", "Debit Note" or "Other". Read the words printed at the top of the
page; do not infer it from the amounts.

Read the invoice header. The supplier is the business that ISSUED this invoice —
the one being paid, usually named at the top. It is NOT the "bill to",
"customer" or "deliver to" party. If you cannot tell which is which, return null
for the supplier rather than choosing.

Dates are ISO YYYY-MM-DD. Money values are numbers, never strings, never
currency-formatted.

STEP 4 — BOUNDARY
List every distinct invoice number appearing anywhere in the file in
invoiceNumbersSeen. A file may contain several separate invoices; report them
all rather than merging them.`;

/** The shape the model is asked to return. A caller validates the answer
 * against this structurally before it is trusted — Finance's established
 * "never blindly trust arbitrary provider JSON" rule. */
export const EXTRACTION_RESPONSE_SHAPE = {
  header: {
    documentType: "Invoice|Credit Note|Debit Note|Other|null",
    supplierName: "string|null",
    supplierVatNumber: "string|null",
    supplierRegistrationNumber: "string|null",
    invoiceNumber: "string|null",
    invoiceDate: "YYYY-MM-DD|null",
    dueDate: "YYYY-MM-DD|null",
    orderReference: "string|null",
    currencyCode: "string|null",
    subtotal: "number|null",
    discountTotal: "number|null",
    vatAmount: "number|null",
    total: "number|null",
    confidence: "number|null",
  },
  lines: [
    {
      description: "string|null",
      supplierSku: "string|null",
      quantity: "number|null",
      uom: "string|null",
      packDescription: "string|null",
      packQuantity: "number|null",
      unitPrice: "number|null",
      discount: "number|null",
      vatRatePercent: "number|null",
      vatAmount: "number|null",
      lineTotal: "number|null",
      confidence: "number|null",
    },
  ],
  invoiceNumbersSeen: ["string"],
  missingFields: ["string"],
  warnings: ["string"],
  declaredLineCount: "number|null",
} as const;

export { DEFAULT_MODEL };

/**
 * Structural validation of a provider answer.
 *
 * Hand-written presence/shape checks, matching the convention
 * `ai/response-validation.ts` already uses ("no schema-validation library
 * exists in this codebase, confirmed before writing this file"). A value
 * that is not a finite number becomes `null` rather than `NaN`, and a
 * placeholder string in a numeric field becomes `null` rather than being
 * coerced to something numeric-looking.
 */
export function parseExtractionResponse(raw: unknown): ExtractionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const rawHeader = (root.header ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(root.lines) ? root.lines : null;
  if (!rawLines) return null;

  return {
    header: {
      documentType: documentType(rawHeader.documentType),
      supplierName: str(rawHeader.supplierName),
      supplierVatNumber: str(rawHeader.supplierVatNumber),
      supplierRegistrationNumber: str(rawHeader.supplierRegistrationNumber),
      invoiceNumber: str(rawHeader.invoiceNumber),
      invoiceDate: isoDate(rawHeader.invoiceDate),
      dueDate: isoDate(rawHeader.dueDate),
      orderReference: str(rawHeader.orderReference),
      currencyCode: str(rawHeader.currencyCode),
      subtotal: num(rawHeader.subtotal),
      discountTotal: num(rawHeader.discountTotal),
      vatAmount: num(rawHeader.vatAmount),
      total: num(rawHeader.total),
      confidence: bounded(rawHeader.confidence),
    },
    lines: rawLines.map((entry) => {
      const line = (entry ?? {}) as Record<string, unknown>;
      return {
        description: str(line.description),
        supplierSku: str(line.supplierSku),
        quantity: num(line.quantity),
        uom: str(line.uom),
        packDescription: str(line.packDescription),
        packQuantity: num(line.packQuantity),
        unitPrice: num(line.unitPrice),
        discount: num(line.discount),
        vatRatePercent: num(line.vatRatePercent),
        vatAmount: num(line.vatAmount),
        lineTotal: num(line.lineTotal),
        confidence: bounded(line.confidence),
      };
    }),
    invoiceNumbersSeen: strArray(root.invoiceNumbersSeen),
    missingFields: strArray(root.missingFields),
    warnings: strArray(root.warnings),
    declaredLineCount: num(root.declaredLineCount),
  };
}

/** Placeholder strings a model may emit despite being told not to. Mapped
 * to null so they can never be stored as data — COST stored exactly these
 * inside money and VAT-number fields. */
const PLACEHOLDERS = new Set(["unknown", "needs review", "n/a", "na", "none", "null", "-", "—", "not visible", "not found"]);

/** Only the four kinds this system reasons about. Anything else is
 * "Other", which is refused rather than assumed to be an invoice. */
function documentType(value: unknown): "Invoice" | "Credit Note" | "Debit Note" | "Other" | null {
  const text = str(value)?.toLowerCase();
  if (!text) return null;
  if (text.includes("credit")) return "Credit Note";
  if (text.includes("debit")) return "Debit Note";
  if (text.includes("invoice")) return "Invoice";
  return "Other";
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // A model may return "1 234,56" or "R1,234.56" despite the instruction.
  // Accepted only when the whole string is unambiguously one number.
  if (typeof value === "string") {
    const cleaned = value.replace(/[\s ]/g, "").replace(/^[A-Z]{0,3}\$?/i, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function bounded(value: unknown): number | null {
  const parsed = num(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function isoDate(value: unknown): string | null {
  const text = str(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? null : text;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter((v): v is string => v !== null);
}
