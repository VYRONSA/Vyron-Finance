import { describe, expect, it } from "vitest";
import { normalizeActions, normalizeConditions } from "./banking-rule-service";

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
