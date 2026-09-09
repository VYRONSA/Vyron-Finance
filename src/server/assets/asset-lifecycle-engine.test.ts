import { describe, expect, it } from "vitest";
import {
  buildAssetDisposalJournalLines,
  buildDepreciationRunJournalLines,
  computeDisposalGainOrLoss,
  resolveAssetClassAccounts,
  DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE,
  DEFAULT_DEPRECIATION_EXPENSE_ACCOUNT_CODE,
  type DisposalAccountCodes,
} from "./asset-lifecycle-engine";
import type { AssetClass } from "./types";

function totalDebits(lines: { debit: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
}
function totalCredits(lines: { credit: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
}

const DEFAULT_DISPOSAL_ACCOUNTS: DisposalAccountCodes = {
  assetAccountCode: "1600",
  accumulatedDepreciationAccountCode: "1650",
  accumulatedImpairmentAccountCode: "1660",
  gainOnDisposalAccountCode: "6250",
  lossOnDisposalAccountCode: "6600",
};

function assetClass(overrides: Partial<AssetClass> & { id: number }): AssetClass {
  return {
    companyId: "co_1",
    name: "Test Class",
    code: "TST",
    defaultDepreciationMethod: "StraightLine",
    defaultUsefulLifeMonths: 60,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    glAssetAccountCode: null,
    glAccumulatedDepreciationAccountCode: null,
    glDepreciationExpenseAccountCode: null,
    glAccumulatedImpairmentAccountCode: null,
    glGainOnDisposalAccountCode: null,
    glLossOnDisposalAccountCode: null,
    ...overrides,
  };
}

describe("resolveAssetClassAccounts", () => {
  it("falls back to the platform default for a null class", () => {
    const accounts = resolveAssetClassAccounts(null);
    expect(accounts.depreciationExpenseAccountCode).toBe(DEFAULT_DEPRECIATION_EXPENSE_ACCOUNT_CODE);
    expect(accounts.accumulatedDepreciationAccountCode).toBe(DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE);
  });

  it("falls back to the platform default for a class that hasn't overridden its accounts", () => {
    const accounts = resolveAssetClassAccounts(assetClass({ id: 1 }));
    expect(accounts.depreciationExpenseAccountCode).toBe(DEFAULT_DEPRECIATION_EXPENSE_ACCOUNT_CODE);
  });

  it("uses a class's own account when it has one", () => {
    const accounts = resolveAssetClassAccounts(assetClass({ id: 1, glDepreciationExpenseAccountCode: "6510", glAccumulatedDepreciationAccountCode: "1651" }));
    expect(accounts.depreciationExpenseAccountCode).toBe("6510");
    expect(accounts.accumulatedDepreciationAccountCode).toBe("1651");
  });
});

describe("buildDepreciationRunJournalLines", () => {
  it("builds a balanced DR Depreciation Expense / CR Accumulated Depreciation journal", () => {
    const result = buildDepreciationRunJournalLines(
      [{ depreciationExpenseAccountCode: "6500", accumulatedDepreciationAccountCode: "1650", amount: 15000 }],
      "January 2026 depreciation run",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6500")?.debit).toBe(15000);
    expect(result.lines.find((l) => l.accountCode === "1650")?.credit).toBe(15000);
  });

  it("groups entries sharing the same account pair into one DR/CR line pair", () => {
    const result = buildDepreciationRunJournalLines(
      [
        { depreciationExpenseAccountCode: "6500", accumulatedDepreciationAccountCode: "1650", amount: 5000 },
        { depreciationExpenseAccountCode: "6500", accumulatedDepreciationAccountCode: "1650", amount: 3000 },
      ],
      "Two assets, same class accounts",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(2);
    expect(result.lines.find((l) => l.accountCode === "6500")?.debit).toBe(8000);
  });

  it("keeps distinct account pairs (different classes) as separate line pairs, still balanced", () => {
    const result = buildDepreciationRunJournalLines(
      [
        { depreciationExpenseAccountCode: "6500", accumulatedDepreciationAccountCode: "1650", amount: 5000 },
        { depreciationExpenseAccountCode: "6510", accumulatedDepreciationAccountCode: "1651", amount: 3000 },
      ],
      "Two assets, different class accounts",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(4);
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6510")?.debit).toBe(3000);
    expect(result.lines.find((l) => l.accountCode === "1651")?.credit).toBe(3000);
  });

  it("refuses to post a zero-amount run", () => {
    const result = buildDepreciationRunJournalLines([{ depreciationExpenseAccountCode: "6500", accumulatedDepreciationAccountCode: "1650", amount: 0 }], "Nothing to depreciate");
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
    const result = buildAssetDisposalJournalLines(120000, 100000, 0, 30000, "1000", DEFAULT_DISPOSAL_ACCOUNTS, "Disposal of vehicle");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6250")?.credit).toBe(10000);
  });

  it("balances a disposal with a loss", () => {
    const result = buildAssetDisposalJournalLines(120000, 80000, 0, 10000, "1000", DEFAULT_DISPOSAL_ACCOUNTS, "Disposal of machinery");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "6600")?.debit).toBe(30000);
  });

  it("balances a write-off (zero proceeds) reusing the same builder", () => {
    const result = buildAssetDisposalJournalLines(50000, 45000, 0, 0, null, DEFAULT_DISPOSAL_ACCOUNTS, "Write-off of obsolete equipment");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    // NBV = 5000, proceeds = 0 -> a loss of 5000
    expect(result.lines.find((l) => l.accountCode === "6600")?.debit).toBe(5000);
    expect(result.lines.some((l) => l.debit > 0 && l.accountCode === "1000")).toBe(false);
  });

  it("clears accumulated impairment too, and still balances", () => {
    const result = buildAssetDisposalJournalLines(100000, 60000, 15000, 20000, "1000", DEFAULT_DISPOSAL_ACCOUNTS, "Disposal with prior impairment");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalDebits(result.lines)).toBe(totalCredits(result.lines));
    expect(result.lines.find((l) => l.accountCode === "1660")?.debit).toBe(15000);
  });

  it("posts to a class's own overridden accounts instead of the platform default", () => {
    const accounts = resolveAssetClassAccounts(assetClass({ id: 1, glAssetAccountCode: "1601", glGainOnDisposalAccountCode: "6251" }));
    const result = buildAssetDisposalJournalLines(120000, 100000, 0, 30000, "1000", accounts, "Disposal of vehicle, class-scoped accounts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.find((l) => l.accountCode === "1601")?.credit).toBe(120000);
    expect(result.lines.find((l) => l.accountCode === "6251")?.credit).toBe(10000);
  });

  it("refuses to post proceeds with no payment account supplied", () => {
    const result = buildAssetDisposalJournalLines(50000, 40000, 0, 5000, null, DEFAULT_DISPOSAL_ACCOUNTS, "Missing payment account");
    expect(result.ok).toBe(false);
  });

  it("refuses to post an asset with no cost", () => {
    const result = buildAssetDisposalJournalLines(0, 0, 0, 0, null, DEFAULT_DISPOSAL_ACCOUNTS, "Nothing to disposal-post");
    expect(result.ok).toBe(false);
  });
});
