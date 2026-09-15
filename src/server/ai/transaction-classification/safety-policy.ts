/**
 * AI classification safety policy — the pure, dependency-free decisions
 * behind the classification queue and the shared provider circuit breaker
 * (migration 0099). Kept free of database and network code so every rule
 * here is directly unit-testable.
 *
 * Why this exists (production investigation, 2026-09-15): the sweep used
 * to re-ask the AI about the same 20 transactions every ~2 minutes, every
 * provider failure was collapsed to an anonymous "failed", and nothing
 * stopped a batch from sending all 20 requests into a provider that was
 * already refusing them.
 *
 * The rules:
 *  - An AUTH/CONFIGURATION failure (401, 402, 403, 404 model/route, or a
 *    missing API key) opens the circuit immediately.
 *  - 3 consecutive timeouts, or 5 consecutive 5xx/provider/network
 *    failures, open it (thresholds enforced in the database).
 *  - A 429 stops the batch and honours a bounded Retry-After; it never
 *    opens the circuit on its own.
 *  - Any provider-level failure stops the current batch: the remaining
 *    transactions are not sent.
 *  - A malformed or invalid model answer is a TRANSACTION outcome (the
 *    provider did respond), not a provider outage.
 */

import { AIProviderError } from "@/server/ai/types";

export const AI_CLASSIFICATION_PROVIDER = "vercel-ai-gateway";
export const AI_PROVIDER_CIRCUIT_SCOPE = "transaction-classification";
/** Internal safety fuse, not the customer's contractual AI quota. The
 * database enforces it as a maximum (a caller can never raise it). */
export const AI_PROVIDER_DAILY_REQUEST_CAP = 100;
export const PROVIDER_MESSAGE_MAX_LENGTH = 300;
/** The existing scheduler bounds for a provider's Retry-After (Phase 26I). */
export const RETRY_AFTER_MIN_MS = 15_000;
export const RETRY_AFTER_MAX_MS = 5 * 60_000;

export type AttemptSource = "sweep" | "import" | "manual";

export type AttemptOutcome =
  | "suggested"
  | "allocated"
  | "no_confidence"
  | "invalid_response"
  | "provider_error"
  | "evidence_error"
  | "write_error";

export type ProviderErrorCategory =
  | "missing-api-key"
  | "unauthorized"
  | "payment-required"
  | "forbidden"
  | "configuration"
  | "timeout"
  | "rate-limit"
  | "server-error"
  | "provider-error"
  | "network"
  | "malformed-response"
  | "invalid-suggestion"
  | "unknown";

export type CircuitSignal = "success" | "auth" | "timeout" | "provider_failure" | "rate_limit" | "none";

/** Only what the provider/SDK actually reported — never estimated. */
export type ProviderUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; gatewayCost?: number };

export type ProviderFailureClassification = {
  category: ProviderErrorCategory;
  httpStatus: number | null;
  /** True when a request actually reached (or was in flight to) the provider. */
  providerRequestMade: boolean;
  /** True when every later request in the batch would very likely fail the same way — stop the batch. */
  providerLevel: boolean;
  circuitSignal: CircuitSignal;
  /** Sanitized, at most 300 characters. */
  providerMessage: string | null;
  /** Bounded (see `boundRetryAfterMs`); null when absent or invalid. */
  retryAfterMs: number | null;
};

const AUTH_CATEGORIES: ReadonlySet<ProviderErrorCategory> = new Set(["missing-api-key", "unauthorized", "payment-required", "forbidden", "configuration"]);
const TRANSACTION_LEVEL_CATEGORIES: ReadonlySet<ProviderErrorCategory> = new Set(["malformed-response", "invalid-suggestion", "unknown"]);

/** Fixed descriptions: the SDK's own texts for these can quote the model's
 * raw answer, which is never stored. */
const FIXED_MESSAGES: Partial<Record<ProviderErrorCategory, string>> = {
  "malformed-response": "The provider's answer could not be parsed or did not match the expected format.",
  "invalid-suggestion": "The provider suggested an account that was not among the offered candidates.",
};

function categoryFromStatus(status: number): ProviderErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 402) return "payment-required";
  if (status === 403) return "forbidden";
  if (status === 404) return "configuration";
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server-error";
  if (status === 424) return "server-error";
  return "provider-error";
}

function circuitSignalFor(category: ProviderErrorCategory): CircuitSignal {
  if (AUTH_CATEGORIES.has(category)) return "auth";
  if (category === "timeout") return "timeout";
  if (category === "rate-limit") return "rate_limit";
  if (category === "server-error" || category === "provider-error" || category === "network") return "provider_failure";
  // The provider answered, just not usefully for this transaction.
  if (category === "malformed-response" || category === "invalid-suggestion") return "success";
  return "none";
}

/** A provider's Retry-After, made safe to store and use: a finite,
 * positive number of milliseconds within the scheduler's existing
 * 15-second to 5-minute bounds; anything else is null. */
export function boundRetryAfterMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, Math.round(value)));
}

/** Classifies anything thrown while asking the provider to classify one
 * transaction. `sensitiveValues` (e.g. the transaction's own description)
 * are removed from any message kept. */
export function classifyClassificationFailure(error: unknown, sensitiveValues: readonly string[] = []): ProviderFailureClassification {
  if (!(error instanceof AIProviderError)) {
    const message = error instanceof Error ? error.message : String(error);
    return { category: "unknown", httpStatus: null, providerRequestMade: false, providerLevel: false, circuitSignal: "none", providerMessage: sanitizeProviderMessage(message, sensitiveValues), retryAfterMs: null };
  }

  const httpStatus = error.httpStatus;
  let category: ProviderErrorCategory;
  if (error.validation) category = "invalid-suggestion";
  else if (httpStatus !== null) category = categoryFromStatus(httpStatus);
  else if (error.code === "missing-api-key") category = "missing-api-key";
  else if (error.code === "timeout") category = "timeout";
  else if (error.code === "rate-limit") category = "rate-limit";
  else if (error.code === "malformed-response") category = "malformed-response";
  else if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(error.providerMessage ?? "")) category = "network";
  else category = "provider-error";

  const providerRequestMade =
    httpStatus !== null || category === "timeout" || category === "malformed-response" || category === "invalid-suggestion";

  return {
    category,
    httpStatus,
    providerRequestMade,
    providerLevel: !TRANSACTION_LEVEL_CATEGORIES.has(category),
    circuitSignal: circuitSignalFor(category),
    providerMessage: FIXED_MESSAGES[category] ?? sanitizeProviderMessage(error.providerMessage ?? error.message, sensitiveValues),
    retryAfterMs: category === "rate-limit" ? boundRetryAfterMs(error.retryAfterMs) : null,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SECRET_FIELD_NAMES =
  "authorization|proxy-authorization|x-api-key|api[_-]?key|apikey|key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|secret|password|passwd|pwd|credentials?|signature|sig|session|cookie|set-cookie|x-vercel-oidc-token";

/** Removes anything credential-like, request/response payload fragments and
 * the caller's own sensitive values, then caps the length. Applied before
 * any provider message is stored, returned, put in an alert or logged; the
 * 300-character bound applies to the FINAL, sanitized text. */
export function sanitizeProviderMessage(message: string | null | undefined, sensitiveValues: readonly string[] = []): string | null {
  if (message === null || message === undefined) return null;
  let s = String(message);
  const configuredKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (configuredKey && configuredKey.length >= 8) s = s.split(configuredKey).join("[redacted]");
  for (const value of sensitiveValues) {
    const v = (value ?? "").trim();
    if (v.length >= 4) s = s.replace(new RegExp(escapeRegExp(v), "gi"), "[redacted]");
  }
  // Credentials embedded in URLs (scheme://user:password@host).
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi, "$1[redacted]@");
  // Whole authorization header values, whatever the scheme.
  s = s.replace(/(\b(?:proxy-)?authorization\b["']?\s*[:=]\s*["']?)[^"'\r\n,;}]*/gi, "$1[redacted]");
  s = s.replace(/\bbearer\s+[^\s"',;]+/gi, "Bearer [redacted]");
  s = s.replace(/\bbasic\s+[A-Za-z0-9+/=]{6,}/gi, "Basic [redacted]");
  s = s.replace(new RegExp(`\\b(${SECRET_FIELD_NAMES})(\\s*["']?\\s*[:=]\\s*["']?)(?!\\[redacted\\])[^\\s"'&,;}]+`, "gi"), "$1$2[redacted]");
  s = s.replace(/\b(?:vck|sk|pk|rk|gw|sb_secret|sb_publishable|ghp|gho|xox[abpr])[-_][A-Za-z0-9_-]{8,}/g, "[redacted]");
  s = s.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "[redacted]");
  s = s.replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? "[redacted]" : m));
  // Request/response payloads: a JSON body is never kept; only a provider
  // "message" value inside it survives, as the diagnostic.
  s = s.replace(/[{[]\s*"[\s\S]*[}\]]/g, (body) => {
    const messages = [...body.matchAll(/"message"\s*:\s*"([^"\\]{1,160})"/g)].map((m) => m[1]);
    return messages.length > 0 ? `{[redacted] message: ${messages.join("; ")}}` : "{[redacted]}";
  });
  // Remaining payload fragments: long quoted strings and JSON-like bodies.
  s = s.replace(/"[^"\r\n]{40,}"/g, '"[redacted]"');
  s = s.replace(/'[^'\r\n]{40,}'/g, "'[redacted]'");
  s = s.replace(/\{[^{}]{60,}\}/g, "{[redacted]}");
  s = s.replace(/\[[^[\]]{60,}\]/g, "[[redacted]]");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length === 0) return null;
  return s.length > PROVIDER_MESSAGE_MAX_LENGTH ? `${s.slice(0, PROVIDER_MESSAGE_MAX_LENGTH - 1)}…` : s;
}

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Keeps only the token/cost numbers the SDK or gateway actually returned. */
export function extractProviderUsage(usage: unknown, providerMetadata?: unknown): ProviderUsage | null {
  const u = (usage ?? {}) as Record<string, unknown>;
  const gateway = ((providerMetadata ?? {}) as Record<string, unknown>).gateway as Record<string, unknown> | undefined;
  const result: ProviderUsage = {};
  const inputTokens = finiteNumber(u.inputTokens);
  const outputTokens = finiteNumber(u.outputTokens);
  const totalTokens = finiteNumber(u.totalTokens);
  const gatewayCost = finiteNumber(gateway?.cost);
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (totalTokens !== undefined) result.totalTokens = totalTokens;
  if (gatewayCost !== undefined) result.gatewayCost = gatewayCost;
  return Object.keys(result).length > 0 ? result : null;
}
