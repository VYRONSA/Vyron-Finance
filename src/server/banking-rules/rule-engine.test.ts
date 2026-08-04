import { describe, expect, it } from "vitest";
import { evaluateTransactionAgainstRules, matchesCondition, ruleMatches, simulateRuleAgainstTransactions, testRuleAgainstRecord } from "./rule-engine";
import type { BankingRule, BankingRuleAction, BankingRuleCondition } from "./types";
import type { EvaluableTransaction } from "./rule-engine";

function txn(overrides: Partial<EvaluableTransaction> = {}): EvaluableTransaction {
  const base = {
    beneficiary: "Telkom SA",
    description: "Monthly line rental",
    reference: "INV-9921",
    notes: "",
    bankAccount: "Main Current Account",
    glAccount: "",
    debit: 450,
    credit: 0,
    ...overrides,
  };
  // Mirrors `rule-processing-service.ts::toEvaluable` — the real Banking
  // caller adds this convenience field itself; the engine no longer
  // computes it (see rule-engine.ts's module docstring on generalizing
  // field resolution to plain property access).
  return { ...base, amount: base.debit > 0 ? base.debit : base.credit };
}

function condition(overrides: Partial<BankingRuleCondition> = {}): BankingRuleCondition {
  return { id: 1, field: "beneficiary", operator: "contains", value: "telkom", value2: null, ...overrides };
}

function action(overrides: Partial<BankingRuleAction> = {}): BankingRuleAction {
  return { id: 1, actionType: "set_gl_account", targetId: null, targetText: "6400", ...overrides };
}

function rule(overrides: Partial<BankingRule> = {}): BankingRule {
  return {
    id: 1,
    companyId: "co_1",
    domain: "Banking",
    ruleType: "GL",
    name: "Telkom -> Telecoms",
    description: "",
    priority: 100,
    isActive: true,
    version: 1,
    createdAt: "",
    updatedAt: "",
    createdBy: "System",
    updatedBy: "System",
    conditions: [condition()],
    actions: [action()],
    ...overrides,
  };
}

describe("matchesCondition", () => {
  it("matches text 'contains' case-insensitively", () => {
    expect(matchesCondition(txn(), condition({ field: "beneficiary", operator: "contains", value: "TELKOM" }))).toBe(true);
  });

  it("does not match when the text is absent", () => {
    expect(matchesCondition(txn(), condition({ field: "beneficiary", operator: "contains", value: "vodacom" }))).toBe(false);
  });

  it("matches 'equals' exactly", () => {
    expect(matchesCondition(txn(), condition({ field: "reference", operator: "equals", value: "inv-9921" }))).toBe(true);
    expect(matchesCondition(txn(), condition({ field: "reference", operator: "equals", value: "inv-99" }))).toBe(false);
  });

  it("matches 'starts_with' and 'ends_with'", () => {
    expect(matchesCondition(txn(), condition({ field: "description", operator: "starts_with", value: "monthly" }))).toBe(true);
    expect(matchesCondition(txn(), condition({ field: "description", operator: "ends_with", value: "rental" }))).toBe(true);
    expect(matchesCondition(txn(), condition({ field: "description", operator: "ends_with", value: "annual" }))).toBe(false);
  });

  it("matches numeric 'greater_than' / 'less_than' / 'between' on amount", () => {
    expect(matchesCondition(txn({ debit: 450 }), condition({ field: "amount", operator: "greater_than", value: "100" }))).toBe(true);
    expect(matchesCondition(txn({ debit: 450 }), condition({ field: "amount", operator: "less_than", value: "100" }))).toBe(false);
    expect(matchesCondition(txn({ debit: 450 }), condition({ field: "amount", operator: "between", value: "400", value2: "500" }))).toBe(true);
    expect(matchesCondition(txn({ debit: 450 }), condition({ field: "amount", operator: "between", value: "500", value2: "400" }))).toBe(true);
    expect(matchesCondition(txn({ debit: 450 }), condition({ field: "amount", operator: "between", value: "0", value2: "10" }))).toBe(false);
  });

  it("'amount' resolves to debit when set, otherwise credit", () => {
    expect(matchesCondition(txn({ debit: 0, credit: 900 }), condition({ field: "amount", operator: "equals", value: "900" }))).toBe(true);
  });

  it("never throws on an invalid regex — treats it as no match", () => {
    expect(matchesCondition(txn(), condition({ field: "beneficiary", operator: "regex", value: "(" }))).toBe(false);
  });

  it("regex matches when valid", () => {
    expect(matchesCondition(txn(), condition({ field: "beneficiary", operator: "regex", value: "^Telkom" }))).toBe(true);
  });

  it("numeric condition with a non-numeric value never matches", () => {
    expect(matchesCondition(txn(), condition({ field: "amount", operator: "greater_than", value: "not-a-number" }))).toBe(false);
  });
});

describe("ruleMatches", () => {
  it("matches when every condition matches (AND logic)", () => {
    const r = rule({ conditions: [condition({ field: "beneficiary", operator: "contains", value: "telkom" }), condition({ field: "debit", operator: "greater_than", value: "0" })] });
    expect(ruleMatches(txn(), r)).toBe(true);
  });

  it("fails when any single condition fails", () => {
    const r = rule({ conditions: [condition({ field: "beneficiary", operator: "contains", value: "telkom" }), condition({ field: "debit", operator: "greater_than", value: "10000" })] });
    expect(ruleMatches(txn(), r)).toBe(false);
  });

  it("an inactive rule never matches, even with satisfied conditions", () => {
    expect(ruleMatches(txn(), rule({ isActive: false }))).toBe(false);
  });

  it("a rule with zero conditions never matches", () => {
    expect(ruleMatches(txn(), rule({ conditions: [] }))).toBe(false);
  });
});

describe("evaluateTransactionAgainstRules", () => {
  it("returns no matches when nothing applies", () => {
    const result = evaluateTransactionAgainstRules(txn({ beneficiary: "Nobody" }), [rule()]);
    expect(result.matchedRules).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });

  it("within the same rule_type, only the highest-priority match wins", () => {
    const low = rule({ id: 1, priority: 200, name: "Low priority GL", actions: [action({ targetText: "9999" })] });
    const high = rule({ id: 2, priority: 10, name: "High priority GL", actions: [action({ targetText: "6400" })] });
    const result = evaluateTransactionAgainstRules(txn(), [low, high]);
    expect(result.matchedRules).toHaveLength(1);
    expect(result.matchedRules[0].id).toBe(2);
    expect(result.actions).toEqual([action({ targetText: "6400" })]);
  });

  it("across different rule_types, every matching type's actions compose", () => {
    const glRule = rule({ id: 1, ruleType: "GL", actions: [action({ actionType: "set_gl_account", targetText: "6400" })] });
    const vatRule = rule({ id: 2, ruleType: "VAT", actions: [action({ actionType: "set_vat_code", targetText: "STD" })] });
    const result = evaluateTransactionAgainstRules(txn(), [glRule, vatRule]);
    expect(result.matchedRules.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(result.actions).toHaveLength(2);
  });

  it("skips a lower-priority match in a type once a higher-priority one wins, but still lets other types fire", () => {
    const glLow = rule({ id: 1, ruleType: "GL", priority: 200 });
    const glHigh = rule({ id: 2, ruleType: "GL", priority: 5 });
    const vat = rule({ id: 3, ruleType: "VAT", actions: [action({ actionType: "set_vat_code", targetText: "STD" })] });
    const result = evaluateTransactionAgainstRules(txn(), [glLow, glHigh, vat]);
    expect(result.matchedRules.map((r) => r.id).sort()).toEqual([2, 3]);
  });
});

describe("simulateRuleAgainstTransactions", () => {
  it("reports which transactions a rule would match, ignoring is_active", () => {
    const r = rule({ isActive: false, conditions: [condition({ field: "beneficiary", operator: "contains", value: "telkom" })] });
    const results = simulateRuleAgainstTransactions(r, [
      { id: 1, ...txn({ beneficiary: "Telkom SA" }) },
      { id: 2, ...txn({ beneficiary: "Vodacom" }) },
    ]);
    expect(results).toEqual([
      { transactionId: 1, matched: true },
      { transactionId: 2, matched: false },
    ]);
  });
});

describe("testRuleAgainstRecord", () => {
  it("matches a hand-built hypothetical record, ignoring is_active", () => {
    const r = rule({ isActive: false, conditions: [condition({ field: "beneficiary", operator: "contains", value: "eskom" })] });
    const result = testRuleAgainstRecord(r, { beneficiary: "Eskom Holdings", description: "", reference: "", notes: "", bankAccount: "", glAccount: "", debit: 0, credit: 0 });
    expect(result.matched).toBe(true);
    expect(result.matchedConditions).toHaveLength(1);
    expect(result.unmatchedConditions).toHaveLength(0);
  });

  it("reports which conditions matched and which didn't for a multi-condition rule", () => {
    const r = rule({
      conditions: [
        condition({ id: 1, field: "beneficiary", operator: "contains", value: "eskom" }),
        condition({ id: 2, field: "debit", operator: "greater_than", value: "1000" }),
      ],
    });
    const result = testRuleAgainstRecord(r, { beneficiary: "Eskom Holdings", description: "", reference: "", notes: "", bankAccount: "", glAccount: "", debit: 500, credit: 0 });
    expect(result.matched).toBe(false);
    expect(result.matchedConditions.map((c) => c.id)).toEqual([1]);
    expect(result.unmatchedConditions.map((c) => c.id)).toEqual([2]);
  });

  it("agrees with ruleMatches/simulateRuleAgainstTransactions — one shared evaluation core", () => {
    const r = rule({ conditions: [condition({ field: "beneficiary", operator: "contains", value: "telkom" })] });
    const record = txn({ beneficiary: "Telkom SA" });
    expect(testRuleAgainstRecord(r, record).matched).toBe(ruleMatches(record, { ...r, isActive: true }));
  });
});
