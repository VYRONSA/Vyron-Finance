import { describe, expect, it } from "vitest";
import { buildAssetDisposalJournalLines, buildDepreciationRunJournalLines, computeDisposalGainOrLoss } from "./asset-lifecycle-engine";

function totalDebits(lines: { debit: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
}
function totalCredits(lines: { credit: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
}

describe("buildDepreciationRunJournalLines", () => {
  it("builds a balanced DR Depreciation Expense / CR Accumulated Depreciation journal", () => {
    const result = buildDepreciationRunJournalLines(15000, "January 2026 depreciation run");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6500")?.debit).toBe(15000);
    expect(result.lines.find((l) => l.accountCode === "1650")?.credit).toBe(15000);
  });

  it("refuses to post a zero-amount run", () => {
    const result = buildDepreciationRunJournalLines(0, "Nothing to depreciate");
    expect(result.ok).toBe(false);
  });
});

describe("computeDisposalGainOrLoss", () => {
  it("computes a gain when proceeds exceed net book value", () => {
    const result = computeDisposalGainOrLoss(120000, 100000, 0, 30000); // NBV=20000, proceeds=30000
    expect(result.isGain).toBe(true);
    expect(result.amount).toBe(10000);
  });

  it("computes a loss when proceeds are below net book value", () => {
    const result = computeDisposalGainOrLoss(120000, 80000, 0, 10000); // NBV=40000, proceeds=10000
    expect(result.isGain).toBe(false);
    expect(result.amount).toBe(30000);
  });
});

describe("buildAssetDisposalJournalLines", () => {
  it("balances a disposal with a gain", () => {
    const result = buildAssetDisposalJournalLines(120000, 100000, 0, 30000, "1000", "Disposal of vehicle");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6250")?.credit).toBe(10000);
  });

  it("balances a disposal with a loss", () => {
    const result = buildAssetDisposalJournalLines(120000, 80000, 0, 10000, "1000", "Disposal of machinery");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6600")?.debit).toBe(30000);
  });

  it("balances a write-off (zero proceeds) reusing the same builder", () => {
    const result = buildAssetDisposalJournalLines(50000, 45000, 0, 0, null, "Write-off of obsolete equipment");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    // NBV = 5000, proceeds = 0 -> a loss of 5000
    expect(result.lines.find((l) => l.accountCode === "6600")?.debit).toBe(5000);
    expect(result.lines.some((l) => l.debit > 0 && l.accountCode === "1000")).toBe(false);
  });

  it("clears accumulated impairment too, and still balances", () => {
    const result = buildAssetDisposalJournalLines(100000, 60000, 15000, 20000, "1000", "Disposal with prior impairment");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "1660")?.debit).toBe(15000);
  });

  it("refuses to post proceeds with no payment account supplied", () => {
    const result = buildAssetDisposalJournalLines(50000, 40000, 0, 5000, null, "Missing payment account");
    expect(result.ok).toBe(false);
  });

  it("refuses to post an asset with no cost", () => {
    const result = buildAssetDisposalJournalLines(0, 0, 0, 0, null, "Nothing to disposal-post");
    expect(result.ok).toBe(false);
  });
});
