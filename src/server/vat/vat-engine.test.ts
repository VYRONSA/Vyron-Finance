import { describe, expect, it } from "vitest";
import { buildVatSettlementJournalLines, isVatSplitConsistentWithType, resolveEffectiveRate, splitVat } from "./vat-engine";
import type { VatRateHistoryEntry } from "./types";

function historyEntry(overrides: Partial<VatRateHistoryEntry> & { id: number }): VatRateHistoryEntry {
  return {
    vatTreatmentId: 1, rate: 15, effectiveFrom: "2026-01-01", effectiveTo: null,
    createdAt: "2026-01-01T00:00:00Z", createdBy: "System",
    ...overrides,
  };
}

describe("resolveEffectiveRate", () => {
  it("returns the rate whose range covers the given date", () => {
    const history = [
      historyEntry({ id: 1, rate: 14, effectiveFrom: "2018-01-01", effectiveTo: "2018-03-31" }),
      historyEntry({ id: 2, rate: 15, effectiveFrom: "2018-04-01", effectiveTo: null }),
    ];
    expect(resolveEffectiveRate(history, "2018-02-01")).toBe(14);
    expect(resolveEffectiveRate(history, "2026-06-01")).toBe(15);
  });

  it("a rate change never applies retroactively — falls back to the most recent prior entry", () => {
    const history = [historyEntry({ id: 1, rate: 14, effectiveFrom: "2018-01-01", effectiveTo: "2018-03-31" })];
    expect(resolveEffectiveRate(history, "2010-01-01")).toBe(null);
  });

  it("returns null when there is no history at all", () => {
    expect(resolveEffectiveRate([], "2026-01-01")).toBe(null);
  });

  it("falls back to the latest entry at or before the date when nothing exactly covers it", () => {
    const history = [
      historyEntry({ id: 1, rate: 14, effectiveFrom: "2018-01-01", effectiveTo: "2018-03-31" }),
      historyEntry({ id: 2, rate: 15, effectiveFrom: "2018-04-01", effectiveTo: "2018-04-01" }),
    ];
    expect(resolveEffectiveRate(history, "2020-01-01")).toBe(15);
  });
});

describe("splitVat", () => {
  it("delegates to the shared splitGrossAmount primitive", () => {
    expect(splitVat(1150, 15)).toEqual({ gross: 1150, net: 1000, vat: 150 });
  });
});

describe("isVatSplitConsistentWithType", () => {
  it("flags a non-zero VAT component on a ZeroRated/Exempt/OutsideScope treatment", () => {
    expect(isVatSplitConsistentWithType("ZeroRated", { gross: 1150, net: 1000, vat: 150 })).toBe(false);
    expect(isVatSplitConsistentWithType("Exempt", { gross: 1150, net: 1000, vat: 0 })).toBe(true);
  });

  it("flags a zero VAT component on a Standard/Import treatment with a non-zero gross amount", () => {
    expect(isVatSplitConsistentWithType("Standard", { gross: 1150, net: 1150, vat: 0 })).toBe(false);
    expect(isVatSplitConsistentWithType("Import", { gross: 1150, net: 1000, vat: 150 })).toBe(true);
  });

  it("never flags a zero-value document regardless of type", () => {
    expect(isVatSplitConsistentWithType("Standard", { gross: 0, net: 0, vat: 0 })).toBe(true);
  });
});

describe("buildVatSettlementJournalLines", () => {
  it("clears both balances and plugs a net payable to VAT Control as a credit", () => {
    const result = buildVatSettlementJournalLines(1000, 600, "VAT settlement");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountCode: "2200", debit: 1000, credit: 0, description: "VAT settlement" },
      { accountCode: "2100", debit: 0, credit: 600, description: "VAT settlement" },
      { accountCode: "2300", debit: 0, credit: 400, description: "VAT settlement" },
    ]);
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("plugs a net receivable to VAT Control as a debit when input exceeds output", () => {
    const result = buildVatSettlementJournalLines(600, 1000, "VAT settlement");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toContainEqual({ accountCode: "2300", debit: 400, credit: 0, description: "VAT settlement" });
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("returns ok:false when both balances are zero", () => {
    const result = buildVatSettlementJournalLines(0, 0, "VAT settlement");
    expect(result.ok).toBe(false);
  });

  it("stays balanced even when the output balance is itself negative", () => {
    const result = buildVatSettlementJournalLines(-200, 300, "VAT settlement");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });
});
