import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/banking-rule-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/banking-rule-repository")>();
  return { ...actual, createBankingRule: vi.fn(), listBankingRules: vi.fn() };
});

import { createBankingRule, DuplicateRuleError, normalizeActions, normalizeConditions, parseBankingRulesCsv, ValidationError, BANKING_RULES_IMPORT_TEMPLATE_HEADERS } from "./banking-rule-service";
import { createBankingRule as repoCreateBankingRule, listBankingRules } from "@/server/repositories/banking-rule-repository";
import type { BankingRule } from "@/server/banking-rules/types";

function existingFishRule(overrides: Partial<BankingRule> = {}): BankingRule {
  return {
    id: 9,
    companyId: "company-1",
    domain: "Banking",
    ruleType: "Supplier",
    name: "Auto: Fish → Supplier",
    description: "",
    priority: 100,
    isActive: true,
    version: 1,
    createdAt: "2026-08-20T07:13:51Z",
    updatedAt: "2026-08-20T07:13:51Z",
    createdBy: "tester",
    updatedBy: "tester",
    conditions: [{ id: 9, field: "description", operator: "contains", value: "Fish", value2: null }],
    actions: [{ id: 15, actionType: "set_supplier", targetId: 636, targetText: null }],
    ...overrides,
  };
}

const newFishRuleInput = {
  domain: "Banking" as const,
  ruleType: "Supplier",
  name: "Auto: Fish → Supplier (2)",
  conditions: [{ field: "description" as const, operator: "contains" as const, value: "Fish", value2: null }],
  actions: [{ actionType: "set_supplier", targetId: 636, targetText: null }],
};

// -----------------------------------------------------------------------
// Phase 41, Part 2 — "the system must never knowingly create an
// identical active Banking Rule twice." Production forensic finding: two
// byte-for-byte identical "Auto: Fish → Supplier" rules (ids 7 and 9)
// existed side by side because the existing `findExactDuplicateRule`
// (correct company-scoped condition+action comparison) was only ever
// wired into a non-blocking client-side pre-check — nothing stopped the
// actual creation call. These tests prove `createBankingRule` itself now
// blocks unconditionally, regardless of what any client checked first.
// -----------------------------------------------------------------------
describe("createBankingRule — duplicate prevention (Phase 41, Part 2)", () => {
  beforeEach(() => {
    vi.mocked(listBankingRules).mockReset();
    vi.mocked(repoCreateBankingRule).mockReset();
  });

  it("throws DuplicateRuleError and never inserts when an identical active rule already exists in this company", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([existingFishRule()]);

    await expect(createBankingRule("company-1", newFishRuleInput)).rejects.toThrow(DuplicateRuleError);
    expect(repoCreateBankingRule).not.toHaveBeenCalled();
  });

  it("the thrown error carries the existing rule so the caller can identify it (Existing Rule: #9)", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([existingFishRule()]);

    try {
      await createBankingRule("company-1", newFishRuleInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateRuleError);
      expect((err as InstanceType<typeof DuplicateRuleError>).existingRule.id).toBe(9);
      expect((err as InstanceType<typeof DuplicateRuleError>).existingRule.name).toBe("Auto: Fish → Supplier");
    }
  });

  it("creates the rule normally when no duplicate exists", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([]);
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 20 }));

    const result = await createBankingRule("company-1", newFishRuleInput);

    expect(result.id).toBe(20);
    expect(repoCreateBankingRule).toHaveBeenCalledWith("company-1", expect.objectContaining({ name: newFishRuleInput.name }));
  });

  // `findExactDuplicateRule` (reused unchanged) already scopes its own
  // lookup via `repo.listBankingRules(companyId, ...)` — a DIFFERENT
  // company's identical rule is never even in the comparison pool.
  it("company isolation: a different company may legitimately have the exact same rule", async () => {
    // listBankingRules is called with companyId — company-2's own mock
    // return represents what its OWN scoped query would find: nothing,
    // since company-1's rule never appears in company-2's results.
    vi.mocked(listBankingRules).mockResolvedValue([]);
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 21, companyId: "company-2" }));

    const result = await createBankingRule("company-2", newFishRuleInput);
    expect(result.id).toBe(21);
    expect(listBankingRules).toHaveBeenCalledWith("company-2", "Banking", "Supplier");
  });

  it("a Supplier rule's action stays set_supplier — never conflated with set_gl_account by the duplicate check", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([]);
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 22 }));

    await createBankingRule("company-1", newFishRuleInput);
    const insertedInput = vi.mocked(repoCreateBankingRule).mock.calls[0][1];
    expect(insertedInput.actions[0].actionType).toBe("set_supplier");
  });

  it("a GL rule's action stays set_gl_account", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([]);
    const glInput = { domain: "Banking" as const, ruleType: "GL", name: "Auto: Fish → GL", conditions: newFishRuleInput.conditions, actions: [{ actionType: "set_gl_account", targetId: null, targetText: "6100" }] };
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 23, ruleType: "GL" }));

    await createBankingRule("company-1", glInput);
    const insertedInput = vi.mocked(repoCreateBankingRule).mock.calls[0][1];
    expect(insertedInput.actions[0].actionType).toBe("set_gl_account");
  });

  it("a different Supplier target is NOT a duplicate", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([existingFishRule({ actions: [{ id: 15, actionType: "set_supplier", targetId: 999, targetText: null }] })]);
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 24 }));

    await expect(createBankingRule("company-1", newFishRuleInput)).resolves.toMatchObject({ id: 24 });
  });

  it("a different condition value is NOT a duplicate", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([existingFishRule({ conditions: [{ id: 9, field: "description", operator: "contains", value: "Chicken", value2: null }] })]);
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 25 }));

    await expect(createBankingRule("company-1", newFishRuleInput)).resolves.toMatchObject({ id: 25 });
  });

  it("a different match field (beneficiary vs description) is NOT a duplicate", async () => {
    vi.mocked(listBankingRules).mockResolvedValue([existingFishRule({ conditions: [{ id: 9, field: "beneficiary", operator: "contains", value: "Fish", value2: null }] })]);
    vi.mocked(repoCreateBankingRule).mockResolvedValue(existingFishRule({ id: 26 }));

    await expect(createBankingRule("company-1", newFishRuleInput)).resolves.toMatchObject({ id: 26 });
  });

  it("validates the rule shape BEFORE ever checking for a duplicate", async () => {
    await expect(createBankingRule("company-1", { ...newFishRuleInput, name: "" })).rejects.toThrow(ValidationError);
    expect(listBankingRules).not.toHaveBeenCalled();
  });
});

// Phase 32 — "the template must be generated from the ACTUAL importer
// contract... do not invent columns." Every header in
// BANKING_RULES_IMPORT_TEMPLATE_HEADERS must be independently provable
// as genuinely recognised by `parseBankingRulesCsv`.
describe("BANKING_RULES_IMPORT_TEMPLATE_HEADERS (Phase 32)", () => {
  it("is accepted end-to-end by the parser with no row-level errors", () => {
    const csv = [
      BANKING_RULES_IMPORT_TEMPLATE_HEADERS.join(","),
      "Banking,GL,Rent Payment,Recurring rent,100,Yes,beneficiary,contains,Landlord,,set_gl_account=6100",
    ].join("\n");
    const { rows, errors } = parseBankingRulesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ domain: "Banking", ruleType: "GL", name: "Rent Payment", condition: { field: "beneficiary", operator: "contains", value: "Landlord" } });
  });
});

// Phase 32A — a non-blank Priority that isn't a valid number must reject
// the row: the old `cell ? Number(cell) : 100` let garbage text through as
// `Number(x)`, silently storing `NaN` into a numeric DB column (and its
// own `.order("priority")` sort).
describe("parseBankingRulesCsv — Priority validation (Phase 32A)", () => {
  const HEADER = BANKING_RULES_IMPORT_TEMPLATE_HEADERS.join(",");

  it("rejects a row with a non-numeric Priority instead of silently storing NaN", () => {
    const csv = [HEADER, "Banking,GL,Rent Payment,,not-a-number,Yes,beneficiary,contains,Landlord,,set_gl_account=6100"].join("\n");
    const { rows, errors } = parseBankingRulesCsv(csv);
    expect(rows).toEqual([]);
    expect(errors).toEqual(['Row 2: Priority "not-a-number" is not a valid number.']);
  });

  it("defaults Priority to 100 when blank", () => {
    const csv = [HEADER, "Banking,GL,Rent Payment,,,Yes,beneficiary,contains,Landlord,,set_gl_account=6100"].join("\n");
    const { rows, errors } = parseBankingRulesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].priority).toBe(100);
  });

  it("still accepts a valid numeric Priority", () => {
    const csv = [HEADER, "Banking,GL,Rent Payment,,50,Yes,beneficiary,contains,Landlord,,set_gl_account=6100"].join("\n");
    const { rows, errors } = parseBankingRulesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].priority).toBe(50);
  });
});

// Transaction Explorer Redesign, Phase 1 — the actual "are these two
// rules identical" comparison behind the new inline grid's "Set Rule"
// duplicate check (`findExactDuplicateRule`). Tested directly as pure
// functions rather than through `findExactDuplicateRule` itself, which
// also does an unmocked Supabase fetch — same "test the pure core
// directly" convention this codebase already uses elsewhere (e.g.
// `transaction-explorer-service.test.ts`'s `parseFilters`/cursor tests).
describe("normalizeConditions", () => {
  it("treats condition order as insignificant", () => {
    const a = [
      { field: "beneficiary", operator: "contains", value: "Acme" },
      { field: "amount", operator: "greater_than", value: "100" },
    ];
    const b = [
      { field: "amount", operator: "greater_than", value: "100" },
      { field: "beneficiary", operator: "contains", value: "Acme" },
    ];
    expect(normalizeConditions(a)).toBe(normalizeConditions(b));
  });

  it("is case-insensitive on the condition value", () => {
    const a = [{ field: "beneficiary", operator: "contains", value: "Acme Office" }];
    const b = [{ field: "beneficiary", operator: "contains", value: "ACME OFFICE" }];
    expect(normalizeConditions(a)).toBe(normalizeConditions(b));
  });

  it("distinguishes a different operator on the same field/value", () => {
    const a = [{ field: "beneficiary", operator: "contains", value: "Acme" }];
    const b = [{ field: "beneficiary", operator: "equals", value: "Acme" }];
    expect(normalizeConditions(a)).not.toBe(normalizeConditions(b));
  });
});

describe("normalizeActions", () => {
  it("treats action order as insignificant", () => {
    const a = [
      { actionType: "set_gl_account", targetText: "6100" },
      { actionType: "flag_for_review", targetText: null },
    ];
    const b = [
      { actionType: "flag_for_review", targetText: null },
      { actionType: "set_gl_account", targetText: "6100" },
    ];
    expect(normalizeActions(a)).toBe(normalizeActions(b));
  });

  it("distinguishes different target ids on the same action type", () => {
    const a = [{ actionType: "set_supplier", targetId: 1 }];
    const b = [{ actionType: "set_supplier", targetId: 2 }];
    expect(normalizeActions(a)).not.toBe(normalizeActions(b));
  });
});
