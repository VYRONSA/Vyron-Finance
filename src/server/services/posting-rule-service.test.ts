import { describe, expect, it } from "vitest";
import {
  buildJournalLinesFromRule,
  buildPostingRulesCsv,
  parsePostingRulesCsv,
  splitGrossAmount,
  validatePostingRuleLines,
  ValidationError,
} from "./posting-rule-service";
import type { PostingRule, PostingRuleLine } from "@/server/general-ledger/types";

function ruleLine(overrides: Partial<PostingRuleLine> = {}): PostingRuleLine {
  return { id: 1, postingRuleId: 1, lineOrder: 0, side: "Debit", role: "bank", fixedAccountCode: "1000", amountSource: "gross", ...overrides };
}

function rule(overrides: Partial<PostingRule> = {}): PostingRule {
  return {
    id: 1,
    companyId: "co_1",
    eventType: "Sales Invoice",
    description: "Customer sales invoice",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    lines: [
      ruleLine({ id: 1, lineOrder: 0, side: "Debit", role: "debtors", fixedAccountCode: "1100", amountSource: "gross" }),
      ruleLine({ id: 2, lineOrder: 1, side: "Credit", role: "sales", fixedAccountCode: "4000", amountSource: "net" }),
      ruleLine({ id: 3, lineOrder: 2, side: "Credit", role: "vat_output", fixedAccountCode: "2200", amountSource: "vat" }),
    ],
    ...overrides,
  };
}

describe("splitGrossAmount", () => {
  it("splits a standard-rated (15%) gross amount into net + vat", () => {
    const result = splitGrossAmount(1150, 15);
    expect(result).toEqual({ gross: 1150, net: 1000, vat: 150 });
  });

  it("collapses net === gross and vat === 0 for a zero-rated amount", () => {
    const result = splitGrossAmount(1000, 0);
    expect(result).toEqual({ gross: 1000, net: 1000, vat: 0 });
  });
});

describe("buildJournalLinesFromRule", () => {
  it("builds a balanced Sales Invoice journal from fixed accounts", () => {
    const result = buildJournalLinesFromRule(rule(), { grossAmount: 1150, vatRatePercent: 15, description: "Invoice INV-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountCode: "1100", debit: 1150, credit: 0, description: "Invoice INV-1" },
      { accountCode: "4000", debit: 0, credit: 1000, description: "Invoice INV-1" },
      { accountCode: "2200", debit: 0, credit: 150, description: "Invoice INV-1" },
    ]);
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });

  it("omits a zero-amount VAT line for a zero-rated event rather than inserting a $0 line", () => {
    const result = buildJournalLinesFromRule(rule(), { grossAmount: 1000, vatRatePercent: 0, description: "Zero-rated invoice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(2);
    expect(result.lines.some((l) => l.accountCode === "2200")).toBe(false);
  });

  it("resolves a dynamic (fixedAccountCode: null) role from the caller-supplied account map", () => {
    const supplierInvoiceRule = rule({
      eventType: "Supplier Invoice",
      lines: [
        ruleLine({ id: 1, side: "Debit", role: "dynamic_expense", fixedAccountCode: null, amountSource: "net" }),
        ruleLine({ id: 2, side: "Debit", role: "vat_input", fixedAccountCode: "2100", amountSource: "vat" }),
        ruleLine({ id: 3, side: "Credit", role: "creditors", fixedAccountCode: "2000", amountSource: "gross" }),
      ],
    });
    const result = buildJournalLinesFromRule(supplierInvoiceRule, {
      grossAmount: 1150,
      vatRatePercent: 15,
      description: "Bill from ABC Supplies",
      accountsByRole: { dynamic_expense: "6000" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.find((l) => l.debit === 1000)?.accountCode).toBe("6000");
  });

  it("fails cleanly when a dynamic role has no supplied account", () => {
    const supplierInvoiceRule = rule({
      lines: [
        ruleLine({ id: 1, side: "Debit", role: "dynamic_expense", fixedAccountCode: null, amountSource: "net" }),
        ruleLine({ id: 2, side: "Credit", role: "creditors", fixedAccountCode: "2000", amountSource: "gross" }),
      ],
    });
    const result = buildJournalLinesFromRule(supplierInvoiceRule, { grossAmount: 1150, vatRatePercent: 15, description: "Bill" });
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/no account supplied for role "dynamic_expense"/i) });
  });

  it("rejects an inactive rule", () => {
    const result = buildJournalLinesFromRule(rule({ isActive: false }), { grossAmount: 1150, vatRatePercent: 15, description: "x" });
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/is inactive/i) });
  });

  it("rejects a rule with no lines", () => {
    const result = buildJournalLinesFromRule(rule({ lines: [] }), { grossAmount: 1150, vatRatePercent: 15, description: "x" });
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/no lines configured/i) });
  });
});

describe("validatePostingRuleLines", () => {
  it("accepts a well-formed set of lines", () => {
    expect(() =>
      validatePostingRuleLines([
        { side: "Debit", role: "bank" },
        { side: "Credit", role: "creditors" },
      ]),
    ).not.toThrow();
  });

  it("rejects fewer than 2 lines", () => {
    expect(() => validatePostingRuleLines([{ side: "Debit", role: "bank" }])).toThrow(ValidationError);
  });

  it("rejects a rule with no Debit line", () => {
    expect(() =>
      validatePostingRuleLines([
        { side: "Credit", role: "a" },
        { side: "Credit", role: "b" },
      ]),
    ).toThrow(ValidationError);
  });

  it("rejects a rule with no Credit line", () => {
    expect(() =>
      validatePostingRuleLines([
        { side: "Debit", role: "a" },
        { side: "Debit", role: "b" },
      ]),
    ).toThrow(ValidationError);
  });

  it("rejects a line with a blank role", () => {
    expect(() =>
      validatePostingRuleLines([
        { side: "Debit", role: "" },
        { side: "Credit", role: "b" },
      ]),
    ).toThrow(ValidationError);
  });
});

describe("buildPostingRulesCsv / parsePostingRulesCsv", () => {
  it("round-trips event type, description, and every line through CSV", () => {
    const rules = [rule()];
    const csv = buildPostingRulesCsv(rules);
    const { rows, errors } = parsePostingRulesCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ eventType: "Sales Invoice", side: "Debit", role: "debtors", fixedAccountCode: "1100", amountSource: "gross" });
    expect(rows[2]).toMatchObject({ side: "Credit", role: "vat_output", fixedAccountCode: "2200", amountSource: "vat" });
  });

  it("round-trips a dynamic (blank fixed account) line as null, not an empty string", () => {
    const dynamicRule = rule({
      lines: [
        { id: 1, postingRuleId: 1, lineOrder: 0, side: "Debit", role: "dynamic_expense", fixedAccountCode: null, amountSource: "net" },
        { id: 2, postingRuleId: 1, lineOrder: 1, side: "Credit", role: "creditors", fixedAccountCode: "2000", amountSource: "gross" },
      ],
    });
    const csv = buildPostingRulesCsv([dynamicRule]);
    const { rows } = parsePostingRulesCsv(csv);
    expect(rows[0].fixedAccountCode).toBeNull();
  });

  it("collects an error per invalid row without throwing", () => {
    const csv = [
      "Event Type,Description,Active,Line Order,Side,Role,Fixed Account Code,Amount Source",
      ",Missing event type,Yes,0,Debit,bank,1000,gross",
      "Bad Side,Description,Yes,0,Sideways,bank,1000,gross",
      "Missing Role,Description,Yes,0,Debit,,1000,gross",
      "Bad Amount,Description,Yes,0,Debit,bank,1000,tax",
      "Valid Rule,Description,Yes,0,Debit,bank,1000,gross",
    ].join("\n");

    const { rows, errors } = parsePostingRulesCsv(csv);
    expect(errors).toHaveLength(4);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("Valid Rule");
  });

  it("reports missing required columns instead of silently parsing garbage", () => {
    const { rows, errors } = parsePostingRulesCsv("Foo,Bar\n1,2");
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/missing required columns/i);
  });
});
