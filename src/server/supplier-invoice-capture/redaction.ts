/**
 * Phase 5L, Decision 2 — the data-minimisation boundary.
 *
 * External AI processing of supplier invoices is permitted. Logging them is
 * not. VYRON COST wrote, to stdout, the first 100 bytes of every raw
 * invoice file in both hex and ASCII, a 500-character prompt preview, the
 * base64 head of the document data URL, and — on any provider error — the
 * ENTIRE provider response body. It also persisted untruncated model
 * transcripts into a table that has no `tenant_id` and `using (true)` RLS.
 *
 * This module is the only sanctioned way this feature emits an operational
 * log line or stores a provider error, and `pii-logging.test.ts` asserts
 * that what comes out of it contains no document content.
 *
 * The rule: logs and audit rows carry METADATA — who, what document, which
 * model, which attempt, how long, what category of failure. Never the
 * invoice.
 */

import type { ExtractionErrorCategory } from "./types";

/** The hard ceiling on any provider-derived string that is stored or
 * logged. Matches `ai_classification_attempts.provider_message` and the
 * `char_length <= 300` CHECK on `ai_extraction_attempts`. */
export const PROVIDER_MESSAGE_MAX_LENGTH = 300;

/**
 * Operator-facing sentences, written by us, keyed by failure category.
 *
 * A provider's own text is never shown as-is: it can echo request content
 * (some providers quote the offending input back), and it is written for a
 * developer, not for the person holding the invoice.
 */
const CATEGORY_MESSAGE: Record<ExtractionErrorCategory, string> = {
  "missing-api-key": "VYRON AI is not configured for this environment. The document is saved and can be captured by hand.",
  unauthorized: "VYRON AI could not authenticate with its provider. The document is saved; extraction will be retried once that is resolved.",
  "payment-required": "VYRON AI's provider account has no remaining credit. The document is saved and can be captured by hand in the meantime.",
  forbidden: "VYRON AI's provider refused this request. The document is saved; extraction will be retried once that is resolved.",
  configuration: "VYRON AI is misconfigured for this environment. The document is saved and can be captured by hand.",
  timeout: "VYRON AI's provider did not respond in time. The document is saved and extraction will be retried.",
  "rate-limit": "VYRON AI's provider is rate-limiting requests. Extraction will be retried shortly.",
  "server-error": "VYRON AI's provider reported an error. The document is saved and extraction will be retried.",
  "provider-error": "VYRON AI's provider reported an error. The document is saved and extraction will be retried.",
  network: "VYRON AI could not reach its provider. The document is saved and extraction will be retried.",
  "malformed-response": "VYRON AI returned an answer that could not be read. The document is saved; try extracting it again.",
  "unsupported-document": "This file could not be read as an invoice. Check it opens correctly, or capture it by hand.",
  unknown: "VYRON AI could not extract this document. It is saved and can be captured by hand.",
};

export function operatorMessageFor(category: ExtractionErrorCategory): string {
  return CATEGORY_MESSAGE[category] ?? CATEGORY_MESSAGE.unknown;
}

/** Anything that looks like encoded document content, a data URL, a key or
 * a long opaque blob. Matched conservatively — a false positive costs a
 * redaction marker in a log line; a false negative leaks an invoice. */
const SUSPECT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, label: "[redacted data-uri]" },
  { pattern: /\b[A-Za-z0-9+/]{120,}={0,2}\b/g, label: "[redacted blob]" },
  { pattern: /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, label: "[redacted key]" },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, label: "[redacted credential]" },
  { pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, label: "[redacted key]" },
];

/**
 * Makes a provider-derived string safe to store.
 *
 * Strips anything blob-like, collapses whitespace (a multi-line provider
 * dump becomes one line, so it cannot smuggle a document through a log
 * viewer), and truncates hard.
 *
 * This is the ONLY function that should ever touch a provider's own error
 * text on its way to a database column or a log.
 */
export function sanitizeProviderMessage(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let text = typeof raw === "string" ? raw : safeStringify(raw);
  for (const { pattern, label } of SUSPECT_PATTERNS) text = text.replace(pattern, label);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > PROVIDER_MESSAGE_MAX_LENGTH ? `${text.slice(0, PROVIDER_MESSAGE_MAX_LENGTH - 1)}…` : text;
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The metadata a capture event or an operational log line may carry.
 *
 * A closed shape on purpose. Adding a field here is a deliberate act with a
 * reviewer present, which is exactly the friction that was missing when
 * COST's diagnostics grew to include raw transcripts.
 */
export type ExtractionLogEvent = {
  event: string;
  companyId: string;
  captureId: number;
  documentId?: number;
  attempt?: number;
  model?: string | null;
  durationMs?: number | null;
  outcome?: string;
  errorCategory?: ExtractionErrorCategory | null;
  httpStatus?: number | null;
  /** Token counts only, as reported by the provider. Never estimated, and
   * never accompanied by the text they counted. */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  /** Counts, not content: how many lines were read, how many findings. */
  lineCount?: number;
  findingCount?: number;
  /** An already-sanitised operator sentence. Never a provider payload. */
  message?: string;
};

/** Field names that must never appear in a log payload, whatever their
 * value. Asserted by `pii-logging.test.ts`. */
const FORBIDDEN_KEYS = new Set([
  "bytes", "buffer", "base64", "dataUrl", "data_url", "fileData", "file_data",
  "prompt", "prompts", "systemPrompt", "input", "messages", "content",
  "rawResponse", "raw_response", "responseBody", "response_body", "outputText", "output_text",
  "rawDetectedText", "raw_detected_text", "transcript", "apiKey", "api_key", "authorization",
]);

/**
 * Builds the object this feature is permitted to log.
 *
 * Unknown keys are dropped rather than passed through, so a future caller
 * cannot widen what is logged by handing this function a richer object.
 */
export function buildLogPayload(event: ExtractionLogEvent): Record<string, unknown> {
  const allowed: (keyof ExtractionLogEvent)[] = [
    "event", "companyId", "captureId", "documentId", "attempt", "model", "durationMs",
    "outcome", "errorCategory", "httpStatus", "usage", "lineCount", "findingCount", "message",
  ];
  const payload: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = event[key];
    if (value === undefined) continue;
    payload[key] = typeof value === "string" ? sanitizeProviderMessage(value) : value;
  }
  return payload;
}

/** True when a payload contains a key this feature must never log. Used by
 * the guard test, and cheap enough to assert in development. */
export function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (containsForbiddenKey(child, depth + 1)) return true;
  }
  return false;
}

/**
 * The single logging entry point for this feature.
 *
 * Everything it emits has passed `buildLogPayload`. There is no variant
 * that takes a free-form object, which is the whole point.
 */
export function logExtractionEvent(event: ExtractionLogEvent): void {
  // The established operational log channel in this codebase.
  console.log("[supplier-invoice-capture]", JSON.stringify(buildLogPayload(event)));
}
