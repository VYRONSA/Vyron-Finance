/**
 * Pure Rule Analytics — per-rule Success %/Failure %/History/Comparison,
 * built on top of the EXISTING `banking_rule_applications` log (which
 * `rule-processing-service.ts::processTransaction` already writes on
 * every match). "Success" is judged the same way
 * `matching-summary-service.ts::buildMatchingSummary` already judges a
 * rule-applied transaction's global success rate — resolved into a real
 * journal, not merely matched — reused here per-rule instead of
 * reintroducing a second definition of "success."
 */

import type { BankingRule } from "./types";

export type RuleApplicationOutcome = {
  ruleId: number;
  bankTransactionId: number;
  appliedAt: string;
  succeeded: boolean;
};

export type RuleAnalyticsEntry = {
  ruleId: number;
  ruleName: string;
  domain: string;
  ruleType: string;
  isActive: boolean;
  version: number;
  appliedCount: number;
  successCount: number;
  failureCount: number;
  successRatePercent: number;
  failureRatePercent: number;
  lastAppliedAt: string | null;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function groupByRule(outcomes: RuleApplicationOutcome[]): Map<number, RuleApplicationOutcome[]> {
  const byRule = new Map<number, RuleApplicationOutcome[]>();
  for (const outcome of outcomes) {
    const list = byRule.get(outcome.ruleId) ?? [];
    list.push(outcome);
    byRule.set(outcome.ruleId, list);
  }
  return byRule;
}

/** One row per rule — the platform's own rules, even ones that have
 * never fired (0 applications, both rates honestly 0, not null/NaN). */
export function buildRuleAnalytics(rules: BankingRule[], outcomes: RuleApplicationOutcome[]): RuleAnalyticsEntry[] {
  const byRule = groupByRule(outcomes);
  return rules
    .map((rule) => {
      const applications = byRule.get(rule.id) ?? [];
      const successCount = applications.filter((a) => a.succeeded).length;
      const failureCount = applications.length - successCount;
      const lastAppliedAt = applications.length === 0 ? null : applications.reduce((latest, a) => (a.appliedAt > latest ? a.appliedAt : latest), applications[0].appliedAt);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        domain: rule.domain,
        ruleType: rule.ruleType,
        isActive: rule.isActive,
        version: rule.version,
        appliedCount: applications.length,
        successCount,
        failureCount,
        successRatePercent: applications.length > 0 ? round1((successCount / applications.length) * 100) : 0,
        failureRatePercent: applications.length > 0 ? round1((failureCount / applications.length) * 100) : 0,
        lastAppliedAt,
      };
    })
    .sort((a, b) => b.appliedCount - a.appliedCount);
}

/** Rule Comparison — a real filter over already-computed analytics, not
 * a second calculation. Preserves the caller's requested order. */
export function compareRuleAnalytics(entries: RuleAnalyticsEntry[], ruleIds: number[]): RuleAnalyticsEntry[] {
  const byId = new Map(entries.map((e) => [e.ruleId, e]));
  return ruleIds.map((id) => byId.get(id)).filter((e): e is RuleAnalyticsEntry => e !== undefined);
}

/** Rule History — one rule's own individual applications, most recent
 * first, for the "when did this rule fire, and did it succeed" drill-
 * down view. */
export function buildRuleHistory(outcomes: RuleApplicationOutcome[], ruleId: number): RuleApplicationOutcome[] {
  return outcomes
    .filter((o) => o.ruleId === ruleId)
    .slice()
    .sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1));
}
