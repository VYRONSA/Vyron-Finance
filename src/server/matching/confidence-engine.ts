/**
 * The ONE Confidence Engine — Product Review Board Matching Platform
 * directive: "One shared service. No module may calculate its own
 * confidence." Formalizes the exact rule-point-sum-then-threshold-band
 * pattern `accounting/matching-engine.ts` already used (ported from the
 * Python reference, numerically pinned, exhaustively tested) — this file
 * extracts that PATTERN into a reusable primitive; it does not change
 * any matching type's own rule set or point values.
 *
 * Every matching type in this platform (Bank Transactions, Customer/
 * Supplier/Merchant Matching, Duplicate Detection, Invoice/Receipt
 * Allocation, ...) expresses its own domain rules as a `MatchRule[]`
 * (which rules fired, and how many points each is worth) and calls
 * `sumConfidence`/`bandConfidence` here — never re-implements the
 * summing or banding itself.
 */

export type MatchRule = { id: string; label: string; points: number; matched: boolean };

export type ConfidenceResult = { score: number; matchedRules: MatchRule[] };

/** Pure — sums the points of every rule that fired. A rule with
 * `matched: false` contributes nothing (kept in the input list so a
 * caller/UI can show which rules were EVALUATED, not only which fired). */
export function sumConfidence(rules: MatchRule[]): ConfidenceResult {
  const matchedRules = rules.filter((r) => r.matched);
  const score = matchedRules.reduce((sum, r) => sum + r.points, 0);
  return { score, matchedRules };
}

export type ConfidenceBand = "Matched" | "Suggested" | "Unmatched";

/** Pure — the one place a raw score becomes a status. `threshold` is
 * caller-supplied (matching-engine.ts's own supplier matching uses 65;
 * other matching types may reasonably use a different bar) rather than
 * hardcoded here, so every matching type still goes through ONE banding
 * function even when its own threshold differs. A score of exactly 0
 * (nothing fired at all) is always Unmatched, regardless of threshold. */
export function bandConfidence(score: number, threshold: number): ConfidenceBand {
  if (score <= 0) return "Unmatched";
  return score >= threshold ? "Matched" : "Suggested";
}

/** Convenience — score + band in one call, the shape most callers want. */
export function evaluateConfidence(rules: MatchRule[], threshold: number): ConfidenceResult & { band: ConfidenceBand } {
  const result = sumConfidence(rules);
  return { ...result, band: bandConfidence(result.score, threshold) };
}
