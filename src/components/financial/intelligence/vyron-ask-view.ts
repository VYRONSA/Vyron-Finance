/**
 * Phase 12 — VYRON Ask. Pure, framework-free presentation logic: adapts
 * the existing `CopilotAnswer` contract (server/copilot/copilot-
 * assistant-engine.ts, reused unchanged) into the brief's own minimal
 * "Answer Contract" (answer / keyPoints / evidence / recommendedActions
 * / sources), and validates a raw API response before anything is
 * rendered — "Otherwise validate the response before rendering it"
 * (brief, section 4). No financial logic lives here; this only reshapes
 * and checks a shape that was already computed server-side.
 */

import type { CopilotAnswer } from "@/server/copilot/copilot-assistant-engine";

export type VyronAskAnswer = {
  answer: string;
  keyPoints: string[];
  evidence: string[];
  /** `href: null` means a real recommendation with no linkable route yet
   * — rendered as plain text, never a fake button. */
  recommendedActions: { label: string; href: string | null }[];
  sources: string[];
  /** Phase 15 — which layer answered: the fixed deterministic catalog,
   * or VYRON AI. `undefined` is treated the same as "VyronIntelligence"
   * everywhere this is read, since every answer built before Phase 15
   * predates the distinction. */
  answeredBy?: "VyronIntelligence" | "VyronAI";
  /** Phase 15 — user-friendly, clickable source references distinct
   * from the raw `evidence` strings above (brief, section 12). */
  evidenceReferences: { label: string; href: string | null }[];
  /** Phase 15 — honest gaps VYRON AI itself flagged in the evidence. */
  uncertainties: string[];
};

/**
 * Prefers the real `actionLinks` a Finding-aware answer carries (real
 * routes only); falls back to `suggestedActions` as plain, unlinked
 * text for the pre-existing financial-statement questions, which don't
 * carry a route today — never invents one.
 */
export function toVyronAskAnswer(copilotAnswer: CopilotAnswer): VyronAskAnswer {
  const recommendedActions =
    copilotAnswer.actionLinks && copilotAnswer.actionLinks.length > 0
      ? copilotAnswer.actionLinks.map((link) => ({ label: link.label, href: link.href }))
      : copilotAnswer.suggestedActions.map((label) => ({ label, href: null }));

  return {
    answer: copilotAnswer.executiveSummary,
    keyPoints: copilotAnswer.keyPoints ?? [],
    evidence: copilotAnswer.evidence,
    recommendedActions,
    sources: copilotAnswer.documentsConsulted,
    answeredBy: copilotAnswer.answeredBy,
    evidenceReferences: copilotAnswer.evidenceReferences ?? [],
    uncertainties: copilotAnswer.uncertainties ?? [],
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isOptionalEvidenceReferenceArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every((v) => v && typeof v === "object" && typeof (v as { label?: unknown }).label === "string" && ((v as { href?: unknown }).href === null || typeof (v as { href?: unknown }).href === "string")))
  );
}

/**
 * Structural validation of a raw API response body before it's trusted
 * — this codebase has no existing schema-validation library (confirmed
 * before writing this file), so this hand-written check follows the
 * same "manual presence/shape check" convention the copilot API routes
 * themselves already use, rather than introducing a new dependency for
 * one call site. Phase 15 — the three new VYRON AI fields are optional
 * (every pre-Phase-15 answer leaves them undefined), but if a response
 * DOES include one, its shape is still checked — a malformed VYRON AI
 * response must never render either.
 */
export function isValidCopilotAnswer(value: unknown): value is CopilotAnswer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.questionId === "string" &&
    typeof v.question === "string" &&
    typeof v.executiveSummary === "string" &&
    typeof v.confidence === "number" &&
    isStringArray(v.evidence) &&
    typeof v.calculationsUsed === "string" &&
    Array.isArray(v.transactionsConsulted) &&
    Array.isArray(v.journalsConsulted) &&
    isStringArray(v.documentsConsulted) &&
    isStringArray(v.suggestedActions) &&
    isStringArray(v.alternativeExplanations) &&
    (v.answeredBy === undefined || v.answeredBy === "VyronIntelligence" || v.answeredBy === "VyronAI") &&
    isOptionalEvidenceReferenceArray(v.evidenceReferences) &&
    (v.uncertainties === undefined || isStringArray(v.uncertainties))
  );
}
