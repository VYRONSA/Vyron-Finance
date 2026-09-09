/**
 * VYRON Business Situation Engine — Phase 14.
 *
 * Pure, framework-independent (no React, no Supabase, no I/O). NOT a new
 * detection engine — every situation here is built entirely from
 * `Finding[]` the Financial Intelligence Engine (Phases 10-13) already
 * produced. This file only asks one question: "do two or more SPECIFIC,
 * already-real findings co-occur in a way this codebase can name and
 * explain?" — never "does this look risky," which would be inventing a
 * correlation.
 *
 * Every rule below references a small, fixed set of STABLE Finding ids
 * (constants owned by financial-intelligence-engine.ts, e.g.
 * "cashflow-negative-balance") — not a category or a keyword match. A
 * situation only fires when EVERY required id is present in the given
 * `Finding[]`, so a false-positive correlation (two unrelated findings
 * that merely share a category) can't occur.
 *
 * The four relationships implemented are exactly the ones the brief
 * itself validates as real, plus one more with the same evidentiary
 * standard (documented below) — no additional situations were added on
 * spec-writer intuition alone:
 *
 *   1. Cash Collection Pressure (WorkingCapital) — negative cash +
 *      overdue customer balances. From the brief's own example.
 *   2. Elevated Payment Review Activity (TransactionRisk) — possible
 *      duplicate payments + large/unusual payment exceptions. From the
 *      brief's own example.
 *   3. Current Financial Pressure (CashPressure) — net loss + negative
 *      cash position. From the brief's own example.
 *   4. Working Capital Pressure (WorkingCapital) — overdue customer
 *      balances + overdue supplier balances. NOT one of the brief's
 *      three worked examples, but the same well-established accounting
 *      relationship as #1 (both sides of the cash conversion cycle
 *      under strain at once) — included because it meets the identical
 *      "two specific, already-real findings" evidentiary bar, not
 *      because it was assumed useful.
 *
 * Data Quality findings never participate in any rule below — a setup
 * gap is not a "condition" that combines into a risk narrative (see
 * Phase 11's own Data-Quality-stays-separate UI decision, which this
 * file preserves rather than overrides).
 *
 * Exception Intelligence review — investigated, deliberately NOT added:
 * customer-concentration/recurring-transaction/repeated-correction
 * findings all have DYNAMIC ids (`recurring-${direction}-${latestTxnId}`
 * etc, one per detected pattern, never a single fixed id), but this
 * engine's `requiredFindingIds` only ever does an exact `byId.get(id)`
 * lookup (see `buildBusinessSituations` below) — there is no prefix/
 * category matching. A rule like "any recurring-transaction finding +
 * negative cash" cannot be expressed today without either enumerating
 * every possible dynamic id (impossible to declare statically) or
 * extending this engine to prefix-match, which is a real engine change,
 * not a one-line rule addition — not done here on spec alone. Separately,
 * no existing Finding represents "declining revenue" as its own signal
 * (only net-loss/negative-cash/margin-reduction exist, each a distinct
 * claim) — inventing that detector purely to enable a "customer
 * concentration + declining revenue" correlation would be backwards
 * (build the correlation to fit a fact, not build the fact to fit a
 * hoped-for correlation). No new `SituationRule` was added.
 */

import type { BusinessSituation, BusinessSituationCategory, Finding, FindingSeverity } from "./types";
import { FINDING_SEVERITY_ORDER } from "./types";

type SituationRule = {
  id: string;
  title: string;
  category: BusinessSituationCategory;
  /** ALL of these Finding ids must be present for the rule to fire. */
  requiredFindingIds: string[];
  /** Honest, non-causal template — "VYRON identified related
   * conditions," never "X is causing Y" (brief, sections 5 and 13). */
  summary: string;
};

const SITUATION_RULES: SituationRule[] = [
  {
    id: "situation-cash-collection-pressure",
    title: "Cash Collection Pressure",
    category: "WorkingCapital",
    requiredFindingIds: ["cashflow-negative-balance", "customers-overdue-balance"],
    summary: "VYRON identified two related conditions: a negative cash position and overdue customer balances.",
  },
  {
    id: "situation-elevated-payment-review-activity",
    title: "Elevated Payment Review Activity",
    category: "TransactionRisk",
    requiredFindingIds: ["banking-exception-PossibleDuplicate", "banking-exception-LargeUnusualPayment"],
    summary: "VYRON identified two related conditions: possible duplicate payments and large or unusual payment exceptions.",
  },
  {
    id: "situation-current-financial-pressure",
    title: "Current Financial Pressure",
    category: "CashPressure",
    requiredFindingIds: ["profitability-net-loss", "cashflow-negative-balance"],
    summary: "VYRON identified two related conditions: a net loss for the current period and a negative cash position.",
  },
  {
    id: "situation-working-capital-pressure",
    title: "Working Capital Pressure",
    category: "WorkingCapital",
    requiredFindingIds: ["customers-overdue-balance", "suppliers-overdue-balance"],
    summary: "VYRON identified two related conditions: overdue customer balances and overdue supplier balances.",
  },
];

/** Most severe among the contributing findings, and never any higher —
 * the brief's own explicit rule (section 8): "Two Medium findings must
 * NOT automatically become Critical." Finding count plays no part in
 * this calculation. */
export function maxSeverity(findings: Pick<Finding, "severity">[]): FindingSeverity {
  let worst: FindingSeverity = "Low";
  for (const f of findings) {
    if (FINDING_SEVERITY_ORDER.indexOf(f.severity) < FINDING_SEVERITY_ORDER.indexOf(worst)) worst = f.severity;
  }
  return worst;
}

/** One entry per distinct `actionHref` across every contributing
 * finding, in finding order — real routes/labels only, nothing invented
 * for the situation itself (brief, section 9). */
export function dedupeRecommendedActions(findings: Pick<Finding, "recommendedAction" | "actionHref">[]): { label: string; href: string }[] {
  const seenHrefs = new Set<string>();
  const actions: { label: string; href: string }[] = [];
  for (const f of findings) {
    if (f.recommendedAction && f.actionHref && !seenHrefs.has(f.actionHref)) {
      seenHrefs.add(f.actionHref);
      actions.push({ label: f.recommendedAction, href: f.actionHref });
    }
  }
  return actions;
}

/**
 * Correlates the given, already-computed `Finding[]` into
 * `BusinessSituation[]` — pure, no I/O, safe to call on any `Finding[]`
 * a caller already has on hand (brief, section 16: "Prefer: Existing
 * findings -> deterministic relationship engine rather than fetching
 * the database again"). The underlying findings are never removed or
 * altered — they remain exactly as `Finding[]` for a caller that only
 * wants Phase 10-13 behaviour (brief, section 3/11).
 *
 * Prioritisation (brief, section 14) — deterministic, documented here
 * rather than as an opaque numeric score (section 14 explicitly forbids
 * inventing one): sorted by (1) severity, most severe first — the same
 * `FINDING_SEVERITY_ORDER` every other sort in this engine already
 * uses; (2) number of contributing findings, more first — a situation
 * proven by more independent real signals is more actionable to lead
 * with; (3) number of real recommended actions available, more first —
 * a situation the user can actually act on now outranks one that's
 * currently informational. "Data quality limitations" (the brief's 4th
 * factor) is handled structurally, not as a score: a situation can only
 * ever be detected when its required findings were themselves
 * computable from real data, so incomplete data naturally suppresses a
 * situation rather than needing a separate confidence penalty.
 */
export function buildBusinessSituations(findings: Finding[]): BusinessSituation[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const situations: BusinessSituation[] = [];

  for (const rule of SITUATION_RULES) {
    const contributing: Finding[] = [];
    let allPresent = true;
    for (const id of rule.requiredFindingIds) {
      const match = byId.get(id);
      if (!match) {
        allPresent = false;
        break;
      }
      contributing.push(match);
    }
    if (!allPresent) continue;

    situations.push({
      id: rule.id,
      title: rule.title,
      summary: rule.summary,
      severity: maxSeverity(contributing),
      category: rule.category,
      evidence: contributing.map((f) => f.evidence),
      contributingFindings: contributing,
      recommendedActions: dedupeRecommendedActions(contributing),
    });
  }

  situations.sort((a, b) => {
    const severityDiff = FINDING_SEVERITY_ORDER.indexOf(a.severity) - FINDING_SEVERITY_ORDER.indexOf(b.severity);
    if (severityDiff !== 0) return severityDiff;
    const countDiff = b.contributingFindings.length - a.contributingFindings.length;
    if (countDiff !== 0) return countDiff;
    return b.recommendedActions.length - a.recommendedActions.length;
  });

  return situations;
}
