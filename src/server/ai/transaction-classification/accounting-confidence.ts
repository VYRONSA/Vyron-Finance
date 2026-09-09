/**
 * Phase 28 — the layer the forensic report's central finding demands:
 * "AI is 92% confident" (the model's own self-assessment) is NOT the
 * same claim as "VYRON has strong accounting evidence this is correct."
 * This module never touches the model's raw `confidence` number itself
 * (that stays exactly what the provider returned — see
 * `classification-engine.ts`) — it computes a SEPARATE, deterministic,
 * explainable `accountingConfidenceLevel` from the model's answer PLUS
 * this company's own real historical evidence
 * (`company-historical-evidence.ts`), and it is THIS value —
 * never the model's own — that the rest of the pipeline (`targetStatusFor`
 * in `transaction-classification-service.ts`) now decides on.
 *
 * Deliberately no invented numeric precision (the forensic report's own
 * explicit instruction: "Do not invent arbitrary mathematical precision
 * simply to make the output look scientific") — the decision is a small,
 * fully-enumerable table over (evidence strength × model agreement),
 * not a weighted formula.
 */

import { confidenceLevelFor, type ConfidenceLevel } from "./types";
import type { CompanyHistoricalPatternEvidence, EvidenceStrength } from "./company-historical-evidence";

export type AccountingConfidenceAssessment = {
  /** The model's own, completely unmodified, self-reported certainty —
   * kept and surfaced so the two are never conflated. */
  modelConfidence: number;
  modelConfidenceLevel: ConfidenceLevel;
  evidenceStrength: EvidenceStrength;
  /** `null` when there's no dominant historical account to agree or
   * disagree with (Weak/None evidence, or an ambiguous pattern). */
  agreesWithHistory: boolean | null;
  /** The value that actually drives the automation decision — see
   * `transaction-classification-service.ts::targetStatusFor`. Never
   * simply copied from `modelConfidenceLevel`. */
  accountingConfidenceLevel: ConfidenceLevel;
  /** An accounting-grounded explanation — the exact replacement for the
   * kind of reasoning that caused the Phase 28 production defect
   * ("FNB OB Pmt... indicates a payment to the bank"). Persisted to
   * `ae_allocation_history` INSTEAD OF the model's own raw explanation
   * text — see `transaction-classification-service.ts`. */
  explanation: string;
  /** The same content as `explanation`, as discrete points — useful for
   * tests and for any future UI that wants to render evidence as a
   * list rather than a paragraph. */
  reasoning: string[];
};

export function assessAccountingConfidence(
  raw: { accountCode: string | null; confidence: number },
  evidence: CompanyHistoricalPatternEvidence,
): AccountingConfidenceAssessment {
  const modelConfidence = raw.accountCode === null ? 0 : Math.max(0, Math.min(100, raw.confidence));
  const modelConfidenceLevel = confidenceLevelFor(modelConfidence);

  if (raw.accountCode === null) {
    return {
      modelConfidence: 0,
      modelConfidenceLevel: "Low",
      evidenceStrength: evidence.strength,
      agreesWithHistory: null,
      accountingConfidenceLevel: "Low",
      explanation: "The AI could not confidently identify a matching account for this transaction.",
      reasoning: ["The AI itself returned no candidate account."],
    };
  }

  const dominant = evidence.accounts[0] ?? null;
  const agreesWithHistory = evidence.dominantAccountCode === null ? null : raw.accountCode === evidence.dominantAccountCode;
  const reasoning: string[] = [];
  let accountingConfidenceLevel: ConfidenceLevel;

  if (evidence.isAmbiguous) {
    accountingConfidenceLevel = "Low";
    reasoning.push(
      `This company's history shows more than one general ledger account used about equally often for similar ${evidence.pattern.direction.toLowerCase()} transactions in this amount range — the pattern is ambiguous, so no account is confidently favoured.`,
    );
  } else if (evidence.strength === "Strong" && dominant) {
    if (agreesWithHistory) {
      accountingConfidenceLevel = "High";
      reasoning.push(
        `Similar transactions (same narration type, amount range, and direction) have been confirmed ${dominant.humanConfirmedCount} times by this company as ${evidence.dominantAccountCode} — the AI's own answer agrees.`,
      );
    } else {
      accountingConfidenceLevel = "Low";
      reasoning.push(
        `This company has repeatedly confirmed similar transactions as ${evidence.dominantAccountCode} (${dominant.humanConfirmedCount} times), which contradicts the AI's suggestion of ${raw.accountCode} — the company's own confirmed history overrides the model's own reasoning here.`,
      );
    }
  } else if (evidence.strength === "Moderate" && dominant) {
    if (agreesWithHistory) {
      accountingConfidenceLevel = "Medium";
      reasoning.push(
        `Similar transactions have previously been confirmed as ${evidence.dominantAccountCode} by this company, though not yet often enough for strong confidence — the AI's answer agrees.`,
      );
    } else {
      accountingConfidenceLevel = "Low";
      reasoning.push(
        `This company's limited prior history for similar transactions points toward ${evidence.dominantAccountCode}, which does not match the AI's suggestion of ${raw.accountCode}.`,
      );
    }
  } else if (evidence.strength === "Weak") {
    accountingConfidenceLevel = "Low";
    reasoning.push(
      "Only prior AI suggestions (never confirmed by a human) exist for similar transactions — this is not treated as reliable evidence on its own, regardless of the model's own stated confidence.",
    );
  } else {
    // "None" — no historical evidence at all for this transaction pattern.
    accountingConfidenceLevel = modelConfidenceLevel === "High" ? "Medium" : modelConfidenceLevel;
    reasoning.push(
      "No company historical pattern exists yet for this type of transaction — the model's own confidence alone is never treated as sufficient for High accounting confidence.",
    );
  }

  return {
    modelConfidence,
    modelConfidenceLevel,
    evidenceStrength: evidence.strength,
    agreesWithHistory,
    accountingConfidenceLevel,
    explanation: reasoning.join(" "),
    reasoning,
  };
}
