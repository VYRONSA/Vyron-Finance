import { describe, expect, it } from "vitest";
import { summarizeTrialBalance } from "./trial-balance-service";
import type { TrialBalanceRow } from "@/server/general-ledger/types";

function row(overrides: Partial<TrialBalanceRow> = {}): TrialBalanceRow {
  return {
    accountId: 1,
    accountCode: "1000",
    description: "Bank",
    accountType: "Asset",
    normalBalance: "Debit",
    totalDebit: 0,
    totalCredit: 0,
    debitBalance: 0,
    creditBalance: 0,
    ...overrides,
  };
}

describe("summarizeTrialBalance", () => {
  it("sums debit and credit balances and reports balanced when they match", () => {
    const rows = [
      row({ accountCode: "1000", debitBalance: 5000, creditBalance: 0 }),
      row({ accountCode: "2000", debitBalance: 0, creditBalance: 2000 }),
      row({ accountCode: "4000", debitBalance: 0, creditBalance: 3000 }),
    ];
    const summary = summarizeTrialBalance(rows);
    expect(summary).toEqual({ totalDebit: 5000, totalCredit: 5000, isBalanced: true });
  });

  it("reports not-balanced when totals genuinely differ (ledger integrity signal)", () => {
    const rows = [row({ debitBalance: 5000 }), row({ creditBalance: 4000 })];
    const summary = summarizeTrialBalance(rows);
    expect(summary.isBalanced).toBe(false);
  });

  it("handles an empty chart (zero and zero) as balanced", () => {
    expect(summarizeTrialBalance([])).toEqual({ totalDebit: 0, totalCredit: 0, isBalanced: true });
  });

  it("tolerates sub-cent floating point noise without flagging it as unbalanced", () => {
    const rows = [row({ debitBalance: 1000.004 }), row({ creditBalance: 999.999 })];
    expect(summarizeTrialBalance(rows).isBalanced).toBe(true);
  });
});
