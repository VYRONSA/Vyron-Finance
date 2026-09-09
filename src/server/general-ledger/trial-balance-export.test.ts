import { describe, expect, it } from "vitest";
import { buildTrialBalanceCsv } from "./trial-balance-export";
import type { TrialBalance } from "./types";

function tb(overrides: Partial<TrialBalance> = {}): TrialBalance {
  return {
    asOfDate: null,
    rows: [
      { accountId: 1, accountCode: "1000", description: "Bank", accountType: "Asset", normalBalance: "Debit", totalDebit: 500, totalCredit: 0, debitBalance: 500, creditBalance: 0 },
      { accountId: 2, accountCode: "4000", description: "Sales", accountType: "Income", normalBalance: "Credit", totalDebit: 0, totalCredit: 500, debitBalance: 0, creditBalance: 500 },
    ],
    totalDebit: 500,
    totalCredit: 500,
    ...overrides,
  };
}

describe("buildTrialBalanceCsv", () => {
  it("includes a header row, one row per account, and a TOTAL row", () => {
    const csv = buildTrialBalanceCsv(tb());
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Account Code,Description,Type,Debit,Credit");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("1000,Bank,Asset,500.00,0.00");
    expect(lines[3]).toBe(",TOTAL,,500.00,500.00");
  });

  it("quotes fields containing commas", () => {
    const csv = buildTrialBalanceCsv(tb({ rows: [{ accountId: 1, accountCode: "1000", description: "Bank, Current", accountType: "Asset", normalBalance: "Debit", totalDebit: 0, totalCredit: 0, debitBalance: 0, creditBalance: 0 }] }));
    expect(csv).toContain('"Bank, Current"');
  });
});
