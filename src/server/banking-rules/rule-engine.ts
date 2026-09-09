/**
 * The pure core of the platform's ONE Rule Engine — no Supabase,
 * exhaustively unit tested, same rigor as
 * `posting-rule-service.ts::buildJournalLinesFromRule` and the Matching
 * Engine's own pure scoring functions. Built for Banking (Module 6);
 * generalized for the Automation Platform (Module 7) to evaluate rules
 * across every domain (Sales/Purchasing/Inventory/GeneralLedger/VAT/
 * Reporting/Communications) — the SAME functions, not a second engine.
 * Field resolution is now plain property access against a generic record
 * rather than a Banking-specific switch, so a Sales rule's conditions can
 * reference `customerId`/`daysOverdue`/whatever fields that domain's own
 * caller chooses to populate, with zero change to the matching algorithm
 * itself.
 *
 * Evaluation model: a record is checked against every ACTIVE rule. Within
 * a rule, every condition must match (AND logic) — a rule with no
 * conditions never matches (an unconditional rule would silently swallow
 * every record of that type, which is never the intent of "a rule").
 * Across rules of the SAME rule_type, only the highest-priority (lowest
 * `priority` number) match wins, so two GL rules can never both try to
 * set the GL account. Across DIFFERENT rule_types, every type's winning
 * rule contributes its actions — a transaction can be resolved by a
 * Merchant rule AND a GL rule AND a VAT rule at once, composing exactly
 * as the Product Review Board's own pipeline describes (Recognise
 * Merchant -> ... -> Determine VAT -> Determine GL).
 */

import type { BankingRule, BankingRuleAction, BankingRuleCondition } from "./types";

/** Any domain's caller shapes its own record — Banking builds one with
 * beneficiary/description/debit/credit/amount/etc, Sales might build one
 * with customerId/totalAmount/daysOverdue. The engine only needs named,
 * string- or number-valued fields; it has no domain-specific knowledge. */
export type EvaluableRecord = { [field: string]: string | number };

/** Kept as the Banking domain's own concrete shape (used throughout
 * `rule-processing-service.ts`) — structurally still an `EvaluableRecord`
 * via the index signature, so every existing Banking caller/test is
 * unaffected. */
export type EvaluableTransaction = {
  beneficiary: string;
  description: string;
  reference: string;
  notes: string;
  bankAccount: string;
  glAccount: string;
  debit: number;
  credit: number;
} & EvaluableRecord;

const NUMERIC_OPERATORS = new Set(["greater_than", "less_than", "between"]);

/** Pure — true when one condition matches. A malformed regex never
 * throws (caught and treated as no-match) so one bad rule can't crash
 * evaluation for every record behind it. An operator decides numeric vs.
 * text comparison, not the field name — this is what makes the engine
 * usable across domains without a fixed, Banking-only field list. */
export function matchesCondition(record: EvaluableRecord, condition: BankingRuleCondition): boolean {
  const raw = record[condition.field];

  if (NUMERIC_OPERATORS.has(condition.operator) || (condition.operator === "equals" && typeof raw === "number")) {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    const target = Number(condition.value);
    if (Number.isNaN(numeric) || Number.isNaN(target)) return false;
    switch (condition.operator) {
      case "equals": return numeric === target;
      case "greater_than": return numeric > target;
      case "less_than": return numeric < target;
      case "between": {
        const target2 = Number(condition.value2);
        if (Number.isNaN(target2)) return false;
        const [lo, hi] = target <= target2 ? [target, target2] : [target2, target];
        return numeric >= lo && numeric <= hi;
      }
      default: return false;
    }
  }

  const text = String(raw ?? "").toLowerCase();
  const value = condition.value.toLowerCase();
  switch (condition.operator) {
    case "contains": return text.includes(value);
    case "equals": return text === value;
    case "starts_with": return text.startsWith(value);
    case "ends_with": return text.endsWith(value);
    case "regex":
      try {
        return new RegExp(condition.value, "i").test(String(raw ?? ""));
      } catch {
        return false;
      }
    default: return false;
  }
}

/** Pure — a rule matches only when it has at least one condition and
 * every condition matches (AND logic). */
export function ruleMatches(record: EvaluableRecord, rule: BankingRule): boolean {
  if (!rule.isActive) return false;
  if (rule.conditions.length === 0) return false;
  return rule.conditions.every((condition) => matchesCondition(record, condition));
}

export type RuleEvaluationResult = {
  matchedRules: BankingRule[];
  actions: BankingRuleAction[];
};

/** Pure — the one place rule resolution logic lives, so both the real
 * processing pipeline (any domain) and the "Simulate" UI action call the
 * exact same code and can never disagree about what a rule would do.
 * Rules are grouped by `ruleType`, not `domain` — a caller is expected to
 * only pass in rules for its own domain (see `rule-processing-service.ts`/
 * a future domain's own equivalent), so cross-domain rule types never
 * collide even though they share one underlying table. */
export function evaluateTransactionAgainstRules(record: EvaluableRecord, rules: BankingRule[]): RuleEvaluationResult {
  const byType = new Map<string, BankingRule[]>();
  for (const rule of rules) {
    const group = byType.get(rule.ruleType) ?? [];
    group.push(rule);
    byType.set(rule.ruleType, group);
  }

  const matchedRules: BankingRule[] = [];
  const actions: BankingRuleAction[] = [];

  for (const group of byType.values()) {
    const sorted = [...group].sort((a, b) => a.priority - b.priority);
    const winner = sorted.find((rule) => ruleMatches(record, rule));
    if (winner) {
      matchedRules.push(winner);
      actions.push(...winner.actions);
    }
  }

  return { matchedRules, actions };
}

/** Pure — the "Simulate"/"Preview" requirement: which of a candidate set
 * of records a single rule (in isolation, regardless of priority against
 * other rules of the same type) would match. Calls the exact same
 * `ruleMatches` the real pipeline uses, so a simulation can never
 * disagree with what actually happens when the rule runs for real. */
export function simulateRuleAgainstTransactions<T extends EvaluableRecord & { id: number }>(
  rule: BankingRule,
  records: T[],
): { transactionId: number; matched: boolean }[] {
  const alwaysActive = { ...rule, isActive: true };
  return records.map((t) => ({ transactionId: t.id, matched: ruleMatches(t, alwaysActive) }));
}

export type RuleTestResult = {
  matched: boolean;
  matchedConditions: BankingRuleCondition[];
  unmatchedConditions: BankingRuleCondition[];
};

/** Pure — the "Test Rule" requirement: does this rule match ONE
 * hand-built hypothetical record (a real transaction isn't required)?
 * Reuses the exact same `ruleMatches`/`matchesCondition` core as
 * Simulate — "Test" and "Simulate" are two entry points into ONE
 * evaluation function, never two competing implementations — but adds a
 * per-condition breakdown Simulate doesn't need (bulk sampling has no
 * use for "which condition failed"; a single hand-built test case does). */
export function testRuleAgainstRecord(rule: BankingRule, record: EvaluableRecord): RuleTestResult {
  const alwaysActive = { ...rule, isActive: true };
  return {
    matched: ruleMatches(record, alwaysActive),
    matchedConditions: rule.conditions.filter((c) => matchesCondition(record, c)),
    unmatchedConditions: rule.conditions.filter((c) => !matchesCondition(record, c)),
  };
}
