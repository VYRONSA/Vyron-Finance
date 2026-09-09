/**
 * Phase 15 — VYRON AI. Domain types for the first REAL LLM capability in
 * VYRON Finance. The architecture is fixed by the brief and must not be
 * inverted:
 *
 *   Financial Data -> Existing Accounting Services -> Financial
 *   Intelligence Engine -> Finding[] -> BusinessSituation[] ->
 *   Evidence Package -> LLM -> user-facing explanation
 *
 * The LLM is never the source of financial truth — it only explains an
 * `EvidencePackage` that was already computed, in full, by the existing
 * deterministic VYRON intelligence layer (Phases 10-14) before this file
 * is ever reached. Nothing in this module fetches company data itself.
 */

import type { BusinessSituationCategory, FindingCategory, FindingSeverity } from "@/server/financial-intelligence/types";

/** Only the fields VYRON AI is allowed to see for one finding — the
 * evidence package is a strict allow-list, never the raw `Finding`
 * (which can carry `companyId`/`createdAt`, unnecessary for an
 * explanation and not worth sending to a third-party provider). */
export type EvidenceFinding = {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: string;
  recommendedAction: string | null;
  actionHref: string | null;
};

/** Only the fields VYRON AI is allowed to see for one Business
 * Situation — `contributingFindingIds` (not the full nested `Finding`
 * objects again) lets the model refer back to `findings` above without
 * duplicating their content in the prompt. */
export type EvidenceSituation = {
  id: string;
  title: string;
  summary: string;
  severity: FindingSeverity;
  category: BusinessSituationCategory;
  evidence: string[];
  contributingFindingIds: string[];
  recommendedActions: { label: string; href: string }[];
};

/**
 * The ONLY financial context ever sent to an LLM provider. Built fresh,
 * server-side, on every request by `buildEvidencePackage` — never
 * accepted from the client (brief, section 17: "The client only
 * provides the question. The server constructs the evidence package.").
 * A strict allow-list: no user emails, no service credentials, no raw
 * database identifiers beyond a Finding/Situation's own already-public
 * `id`, no company data beyond what's needed to answer this question.
 */
export type EvidencePackage = {
  companyId: string;
  companyName: string;
  asOfDate: string;
  question: string;
  findings: EvidenceFinding[];
  situations: EvidenceSituation[];
  totalCash: number | null;
  netProfit: number | null;
  /** The one real, existing route every evidence reference can safely
   * link back to — never a fabricated per-finding deep link. */
  intelligenceCentreHref: string;
};

/** Session-only conversation context (brief, section 16) — never
 * persisted. Supplied by the client as "what was already said in this
 * browser session," used only to keep the LLM's tone/continuity
 * coherent across turns. NEVER treated as a source of financial
 * evidence — the server rebuilds `EvidencePackage` from real data on
 * every single request regardless of what a conversation turn claims. */
export type ConversationTurn = { role: "user" | "assistant"; content: string };

/** The LLM's own structured output contract (brief, section 13). */
export type VyronAiStructuredResponse = {
  answer: string;
  keyPoints: string[];
  evidenceReferences: { label: string; href: string | null }[];
  recommendedActions: { label: string; href: string }[];
  uncertainties: string[];
};

export type AIProviderErrorCode = "missing-api-key" | "timeout" | "rate-limit" | "provider-error" | "malformed-response";

/** Every failure mode section 19/23 requires being able to handle,
 * collapsed into one typed error so callers can log the `code` (never
 * the raw provider stack trace — brief, section 19/25) and always fall
 * back to deterministic VYRON Intelligence (brief, section 7). */
export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  /** Phase 26I — when the provider itself said exactly how long to wait
   * (a `Retry-After` response header on a 429), the real, provider-
   * specified cooldown in milliseconds. Only ever meaningful for
   * `code === "rate-limit"`; `null` when the provider gave no such
   * header, in which case callers fall back to their own conservative
   * default — never a guess dressed up as the provider's own
   * instruction. */
  readonly retryAfterMs: number | null;
  constructor(code: AIProviderErrorCode, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.name = "AIProviderError";
  }
}

/**
 * The provider abstraction (brief, section 2) — "the provider must be
 * replaceable." Nothing outside `src/server/ai/providers/*` may depend
 * on a specific vendor's SDK; every caller depends on this interface
 * only, so swapping providers is a one-file change.
 */
export type AIProvider = {
  generateResponse(params: { systemPrompt: string; evidence: EvidencePackage; conversation: ConversationTurn[] }): Promise<VyronAiStructuredResponse>;
};
