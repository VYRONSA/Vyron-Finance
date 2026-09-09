import { describe, expect, it } from "vitest";
import { detectRuleConflicts } from "./conflict-detection";
import type { BankingRule } from "./types";

let ruleIdSeq = 0;
function rule(overrides: Partial<BankingRule> & { conditions: BankingRule["conditions"]; actions: BankingRule["actions"] }): BankingRule {
  ruleIdSeq += 1;
  return {
    id: ruleIdSeq,
    companyId: "co_1",
    domain: "Banking",
    ruleType: "GL",
    name: `Rule ${ruleIdSeq}`,
    description: "",
    priority: 100,
    isActive: true,
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: "System",
    updatedBy: "System",
    ...overrides,
  };
}

function condition(field: string, operator: BankingRule["conditions"][number]["operator"], value: string): BankingRule["conditions"][number] {
  return { id: 0, field, operator, value, value2: null };
}

function action(actionType: string, targetText: string | null = null, targetId: number | null = null): BankingRule["actions"][number] {
  return { id: 0, actionType, targetId, targetText };
}

describe("detectRuleConflicts", () => {
  it("flags two rules that both match the same beneficiary equals-value with different GL accounts", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "5000")] }),
    ];
    const conflicts = detectRuleConflicts(rules);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sharedField).toBe("beneficiary");
  });

  it("flags a contains-rule and an equals-rule whose value contains the contains-value, with disagreeing actions", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "contains", "ACME")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies Ltd")], actions: [action("set_gl_account", "5000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(1);
  });

  it("does not flag rules with the same action target (no real disagreement)", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "contains", "ACME")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "4000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(0);
  });

  it("does not flag rules whose condition values cannot overlap", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "Beta Traders")], actions: [action("set_gl_account", "5000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(0);
  });

  it("does not flag rules that share no condition field at all", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "contains", "ACME")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("reference", "contains", "INV")], actions: [action("set_gl_account", "5000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(0);
  });

  it("does not flag a disabled rule against an active one", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "4000")] }),
      rule({ isActive: false, conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "5000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(0);
  });

  it("does not flag rules with different actionTypes even if conditions overlap", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_vat_code", "Standard")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(0);
  });

  it("flags starts_with vs ends_with on the same field as a possible overlap", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "starts_with", "ACME")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "ends_with", "Supplies")], actions: [action("set_gl_account", "5000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(1);
  });

  it("does not flag regex conditions (no reliable overlap check)", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "regex", "^ACME.*")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME Supplies")], actions: [action("set_gl_account", "5000")] }),
    ];
    expect(detectRuleConflicts(rules)).toHaveLength(0);
  });

  it("compares each pair only once and never a rule with itself", () => {
    const rules = [
      rule({ conditions: [condition("beneficiary", "equals", "ACME")], actions: [action("set_gl_account", "4000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME")], actions: [action("set_gl_account", "5000")] }),
      rule({ conditions: [condition("beneficiary", "equals", "ACME")], actions: [action("set_gl_account", "6000")] }),
    ];
    // 3 rules, all pairwise conflicting -> C(3,2) = 3 conflicts, not 6 or 9.
    expect(detectRuleConflicts(rules)).toHaveLength(3);
  });
});
