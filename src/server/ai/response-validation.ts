/**
 * Phase 15 — "Never blindly trust arbitrary provider JSON" (brief,
 * section 13). Two independent defenses, both pure:
 *
 *  1. `isValidVyronAiStructuredResponse` — structural validation, the
 *     same hand-written "manual presence/shape check" convention this
 *     codebase already uses for provider responses (see
 *     `vyron-ask-view.ts::isValidCopilotAnswer` — no schema-validation
 *     library exists in this codebase, confirmed before writing this
 *     file, so this follows the same convention rather than introducing
 *     one for a single call site).
 *  2. `sanitizeVyronAiResponse` — even a structurally valid response can
 *     still contain a HALLUCINATED route the model invented despite the
 *     system prompt's instruction not to (brief, section 14: "may NOT
 *     invent routes, buttons, workflows"). This strips any recommended
 *     action or evidence reference whose `href` is not one of the real
 *     hrefs present in the `EvidencePackage` the model was actually
 *     given — a concrete, code-level enforcement of that rule, not just
 *     a prompt instruction the model could ignore.
 */

import type { EvidencePackage, VyronAiStructuredResponse } from "./types";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isEvidenceReferenceArray(value: unknown): value is { label: string; href: string | null }[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === "object" && typeof (v as { label?: unknown }).label === "string" && ((v as { href?: unknown }).href === null || typeof (v as { href?: unknown }).href === "string"));
}

function isRecommendedActionArray(value: unknown): value is { label: string; href: string }[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === "object" && typeof (v as { label?: unknown }).label === "string" && typeof (v as { href?: unknown }).href === "string");
}

export function isValidVyronAiStructuredResponse(value: unknown): value is VyronAiStructuredResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.answer === "string" &&
    v.answer.trim().length > 0 &&
    isStringArray(v.keyPoints) &&
    isEvidenceReferenceArray(v.evidenceReferences) &&
    isRecommendedActionArray(v.recommendedActions) &&
    isStringArray(v.uncertainties)
  );
}

/** Every real href the model was actually shown — the only hrefs a
 * sanitized response may reference. */
function realHrefs(evidence: EvidencePackage): Set<string> {
  const hrefs = new Set<string>([evidence.intelligenceCentreHref]);
  for (const f of evidence.findings) if (f.actionHref) hrefs.add(f.actionHref);
  for (const s of evidence.situations) for (const a of s.recommendedActions) hrefs.add(a.href);
  return hrefs;
}

export function sanitizeVyronAiResponse(response: VyronAiStructuredResponse, evidence: EvidencePackage): VyronAiStructuredResponse {
  const allowed = realHrefs(evidence);
  return {
    ...response,
    evidenceReferences: response.evidenceReferences.filter((ref) => ref.href === null || allowed.has(ref.href)),
    recommendedActions: response.recommendedActions.filter((action) => allowed.has(action.href)),
  };
}
