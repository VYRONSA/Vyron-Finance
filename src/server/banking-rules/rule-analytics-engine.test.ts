import { describe, expect, it } from "vitest";
import { buildRuleAnalytics, buildRuleHistory, compareRuleAnalytics, type RuleApplicationOutcome } from "./rule-analytics-engine";
import type { BankingRule } from "./types";

function rule(overrides: Partial<BankingRule> = {}): BankingRule {
  return {
    id: 1, companyId: "co_1", domain: "Banking", ruleType: "Merchant", name: "Eskom Merchant",
    description: "", priority: 100, isActive: true, version: 1,
    createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "System", updatedBy: "System",
    conditions: [], actions: [], ...overrides,
  };
}

function outcome(overrides: Partial<RuleApplicationOutcome> = {}): RuleApplicationOutcome {
  return { ruleId: 1, bankTransactionId: 1, appliedAt: "2026-01-01T00:00:00Z", succeeded: true, ...overrides };
}

describe("buildRuleAnalytics", () => {
  it("computes 0 applied / 0% rates for a rule that has never fired", () => {
    const [entry] = buildRuleAnalytics([rule()], []);
    expect(entry).toMatchObject({ appliedCount: 0, successCount: 0, failureCount: 0, successRatePercent: 0, failureRatePercent: 0, lastAppliedAt: null });
  });

  it("computes success/failure counts and rates from real outcomes", () => {
    const outcomes = [
      outcome({ succeeded: true, appliedAt: "2026-01-01T00:00:00Z" }),
      outcome({ succeeded: true, appliedAt: "2026-01-02T00:00:00Z" }),
      outcome({ succeeded: false, appliedAt: "2026-01-03T00:00:00Z" }),
    ];
    const [entry] = buildRuleAnalytics([rule()], outcomes);
    expect(entry.appliedCount).toBe(3);
    expect(entry.successCount).toBe(2);
    expect(entry.failureCount).toBe(1);
    expect(entry.successRatePercent).toBeCloseTo(66.7, 1);
    expect(entry.failureRatePercent).toBeCloseTo(33.3, 1);
    expect(entry.lastAppliedAt).toBe("2026-01-03T00:00:00Z");
  });

  it("never attributes one rule's outcomes to another rule", () => {
    const rules = [rule({ id: 1, name: "Rule A" }), rule({ id: 2, name: "Rule B" })];
    const outcomes = [outcome({ ruleId: 1, succeeded: true }), outcome({ ruleId: 2, succeeded: false })];
    const entries = buildRuleAnalytics(rules, outcomes);
    const a = entries.find((e) => e.ruleId === 1)!;
    const b = entries.find((e) => e.ruleId === 2)!;
    expect(a.successCount).toBe(1);
    expect(a.failureCount).toBe(0);
    expect(b.successCount).toBe(0);
    expect(b.failureCount).toBe(1);
  });

  it("sorts by applied count descending", () => {
    const rules = [rule({ id: 1 }), rule({ id: 2 })];
    const outcomes = [outcome({ ruleId: 2 }), outcome({ ruleId: 2 }), outcome({ ruleId: 1 })];
    const entries = buildRuleAnalytics(rules, outcomes);
    expect(entries[0].ruleId).toBe(2);
    expect(entries[1].ruleId).toBe(1);
  });
});

describe("compareRuleAnalytics", () => {
  it("returns only the requested rules, in requested order", () => {
    const entries = buildRuleAnalytics([rule({ id: 1 }), rule({ id: 2 }), rule({ id: 3 })], []);
    const compared = compareRuleAnalytics(entries, [3, 1]);
    expect(compared.map((c) => c.ruleId)).toEqual([3, 1]);
  });

  it("silently skips an id that has no matching entry rather than throwing", () => {
    const entries = buildRuleAnalytics([rule({ id: 1 })], []);
    const compared = compareRuleAnalytics(entries, [1, 999]);
    expect(compared.map((c) => c.ruleId)).toEqual([1]);
  });
});

describe("buildRuleHistory", () => {
  it("returns only the given rule's own applications, most recent first", () => {
    const outcomes = [
      outcome({ ruleId: 1, bankTransactionId: 10, appliedAt: "2026-01-01T00:00:00Z" }),
      outcome({ ruleId: 2, bankTransactionId: 20, appliedAt: "2026-01-02T00:00:00Z" }),
      outcome({ ruleId: 1, bankTransactionId: 11, appliedAt: "2026-01-03T00:00:00Z" }),
    ];
    const history = buildRuleHistory(outcomes, 1);
    expect(history.map((h) => h.bankTransactionId)).toEqual([11, 10]);
  });
});
