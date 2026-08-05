/**
 * Pilot Review Round 1, Phase 8 — "Conflict Detection." Genuinely
 * greenfield: no prior implementation existed anywhere in this codebase
 * (only two unrelated marketing-copy mentions of the phrase). A pure,
 * unit-testable heuristic — not a full SAT/regex solver, which would be
 * real over-engineering for what this needs to catch in practice: two
 * ACTIVE rules whose conditions could plausibly both match the same real
 * transaction, but whose actions would then disagree.
 *
 * Heuristic, disclosed: two rules conflict when they share at least one
 * condition field (almost always `beneficiary` in practice) whose values
 * could overlap for some real string, AND they carry actions of the same
 * `actionType` with different targets. Requiring only ONE shared,
 * overlapping field (not every field) matches the common real mistake —
 * "I already have a rule for ACME, why did this transaction go to the
 * wrong account" — two rules narrowing the SAME identifying field
 * differently. Rules that share no fields at all are not flagged: with
 * no field in common there is no basis to say they're actually competing
 * for the same transaction rather than two independent, compatible rules.
 */
import type { BankingRule, BankingRuleAction, BankingRuleCondition, ConditionOperator } from "./types";

function normalizedOverlap(operatorA: ConditionOperator, valueA: string, operatorB: ConditionOperator, valueB: string): boolean {
  const a = valueA.trim().toLowerCase();
  const b = valueB.trim().toLowerCase();
  if (!a || !b) return false;

  if (operatorA === "equals" && operatorB === "equals") return a === b;
  if (operatorA === "equals") return matchesAgainstEquals(a, operatorB, b);
  if (operatorB === "equals") return matchesAgainstEquals(b, operatorA, a);

  if (operatorA === "contains" || operatorB === "contains") return a.includes(b) || b.includes(a);
  if (operatorA === "starts_with" && operatorB === "starts_with") return a.startsWith(b) || b.startsWith(a);
  if (operatorA === "ends_with" && operatorB === "ends_with") return a.endsWith(b) || b.endsWith(a);
  if ((operatorA === "starts_with" && operatorB === "ends_with") || (operatorA === "ends_with" && operatorB === "starts_with")) {
    // A string starting with one value AND ending with the other is
    // always constructible (as long as they're not mutually exclusive in
    // length for very short values) — treat as a real possible overlap.
    return true;
  }
  // regex/greater_than/less_than/between: no reliable string-level
  // overlap check without evaluating the expression against real data —
  // deliberately not flagged, to keep this heuristic's false-positive
  // rate low rather than guessing.
  return false;
}

function matchesAgainstEquals(equalsValue: string, otherOperator: ConditionOperator, otherValue: string): boolean {
  if (otherOperator === "contains") return equalsValue.includes(otherValue);
  if (otherOperator === "starts_with") return equalsValue.startsWith(otherValue);
  if (otherOperator === "ends_with") return equalsValue.endsWith(otherValue);
  return false;
}

function conditionsOverlapOnSharedField(conditionsA: BankingRuleCondition[], conditionsB: BankingRuleCondition[]): string | null {
  for (const ca of conditionsA) {
    for (const cb of conditionsB) {
      if (ca.field !== cb.field) continue;
      if (normalizedOverlap(ca.operator, ca.value, cb.operator, cb.value)) return ca.field;
    }
  }
  return null;
}

function conflictingActionPair(actionsA: BankingRuleAction[], actionsB: BankingRuleAction[]): { a: BankingRuleAction; b: BankingRuleAction } | null {
  for (const aa of actionsA) {
    for (const ab of actionsB) {
      if (aa.actionType !== ab.actionType) continue;
      const sameTarget = aa.targetId !== null && aa.targetId === ab.targetId ? true : aa.targetText !== null && aa.targetText === ab.targetText;
      if (!sameTarget) return { a: aa, b: ab };
    }
  }
  return null;
}

export type RuleConflict = {
  ruleAId: number;
  ruleBId: number;
  ruleAName: string;
  ruleBName: string;
  sharedField: string;
  reason: string;
};

/** Only ACTIVE rules are worth flagging — a disabled rule can't actually
 * fire, so it can't conflict with anything in practice. Compares every
 * pair once (`i < j`), same rule never compared with itself. */
export function detectRuleConflicts(rules: BankingRule[]): RuleConflict[] {
  const active = rules.filter((r) => r.isActive);
  const conflicts: RuleConflict[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const ruleA = active[i];
      const ruleB = active[j];
      const sharedField = conditionsOverlapOnSharedField(ruleA.conditions, ruleB.conditions);
      if (!sharedField) continue;

      const actionConflict = conflictingActionPair(ruleA.actions, ruleB.actions);
      if (!actionConflict) continue;

      conflicts.push({
        ruleAId: ruleA.id,
        ruleBId: ruleB.id,
        ruleAName: ruleA.name,
        ruleBName: ruleB.name,
        sharedField,
        reason: `Both rules can match on "${sharedField}", but disagree on ${actionConflict.a.actionType} (priority ${ruleA.priority} vs ${ruleB.priority} decides which wins).`,
      });
    }
  }

  return conflicts;
}
