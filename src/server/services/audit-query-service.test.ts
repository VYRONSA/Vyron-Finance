import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateQuery } from "./audit-query-service";

describe("evaluateCondition", () => {
  it("evaluates gt/gte/lt/lte numeric comparisons", () => {
    expect(evaluateCondition({ amount: 600000 }, { field: "amount", operator: "gt", value: 500000 })).toBe(true);
    expect(evaluateCondition({ amount: 500000 }, { field: "amount", operator: "gt", value: 500000 })).toBe(false);
    expect(evaluateCondition({ amount: 500000 }, { field: "amount", operator: "gte", value: 500000 })).toBe(true);
  });

  it("evaluates eq/neq", () => {
    expect(evaluateCondition({ sourceType: "manual" }, { field: "sourceType", operator: "eq", value: "manual" })).toBe(true);
    expect(evaluateCondition({ sourceType: "manual" }, { field: "sourceType", operator: "neq", value: "manual" })).toBe(false);
  });

  it("evaluates isWeekend against a date field", () => {
    expect(evaluateCondition({ journalDate: "2026-01-03" }, { field: "journalDate", operator: "isWeekend" })).toBe(true); // Saturday
    expect(evaluateCondition({ journalDate: "2026-01-05" }, { field: "journalDate", operator: "isWeekend" })).toBe(false); // Monday
  });
});

describe("evaluateQuery", () => {
  it("filters records that satisfy every condition (AND)", () => {
    const records = [{ amount: 600000, sourceType: "manual" }, { amount: 600000, sourceType: "sales_invoice" }, { amount: 100, sourceType: "manual" }];
    const matched = evaluateQuery(records, { source: "journals", conditions: [{ field: "amount", operator: "gt", value: 500000 }, { field: "sourceType", operator: "eq", value: "manual" }] });
    expect(matched).toHaveLength(1);
  });
});
