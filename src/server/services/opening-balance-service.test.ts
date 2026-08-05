import { describe, expect, it } from "vitest";
import { netOpeningBalanceLines } from "./opening-balance-service";

describe("netOpeningBalanceLines", () => {
  it("splits a single positive amount into a debit line", () => {
    const result = netOpeningBalanceLines([{ accountCode: "1000", amount: 5000 }]);
    expect(result.lines).toEqual([{ accountCode: "1000", debit: 5000, credit: 0, description: "Opening balance" }]);
    expect(result.totalDebit).toBe(5000);
    expect(result.totalCredit).toBe(0);
  });

  it("splits a single negative amount into a credit line", () => {
    const result = netOpeningBalanceLines([{ accountCode: "2000", amount: -3000 }]);
    expect(result.lines).toEqual([{ accountCode: "2000", debit: 0, credit: 3000, description: "Opening balance" }]);
    expect(result.totalCredit).toBe(3000);
  });

  it("nets multiple entries against the same account code into one line", () => {
    const result = netOpeningBalanceLines([
      { accountCode: "1100", amount: 1000 },
      { accountCode: "1100", amount: 500 },
      { accountCode: "1100", amount: -200 },
    ]);
    expect(result.lines).toEqual([{ accountCode: "1100", debit: 1300, credit: 0, description: "Opening balance" }]);
  });

  it("drops accounts that net to exactly zero", () => {
    const result = netOpeningBalanceLines([
      { accountCode: "1100", amount: 1000 },
      { accountCode: "1100", amount: -1000 },
      { accountCode: "2000", amount: 500 },
    ]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].accountCode).toBe("2000");
  });

  it("produces a genuinely balanced set of lines across multiple accounts (Debtors/Creditors/Bank/GL rollup)", () => {
    const result = netOpeningBalanceLines([
      { accountCode: "1000-BANK", amount: 5000 },
      { accountCode: "1100-DEBTORS", amount: 3000 },
      { accountCode: "2000-CREDITORS", amount: -2000 },
      { accountCode: "2400-VAT", amount: -1000 },
      { accountCode: "2500-LOAN", amount: -15000 },
      { accountCode: "1500-ASSET", amount: 10000 },
    ]);
    expect(result.totalDebit).toBe(result.totalCredit);
    expect(result.totalDebit).toBe(18000);
  });

  it("handles floating-point cents correctly without drift", () => {
    const result = netOpeningBalanceLines([
      { accountCode: "1000", amount: 100.1 },
      { accountCode: "1000", amount: 200.2 },
      { accountCode: "2000", amount: -300.3 },
    ]);
    expect(result.totalDebit).toBe(300.3);
    expect(result.totalCredit).toBe(300.3);
  });

  it("returns no lines and zero totals for an empty entry list", () => {
    const result = netOpeningBalanceLines([]);
    expect(result.lines).toEqual([]);
    expect(result.totalDebit).toBe(0);
    expect(result.totalCredit).toBe(0);
  });

  it("detects an unbalanced set via mismatched totals (caller decides how to react)", () => {
    const result = netOpeningBalanceLines([
      { accountCode: "1000", amount: 5000 },
      { accountCode: "2000", amount: -4000 },
    ]);
    expect(result.totalDebit).not.toBe(result.totalCredit);
    expect(result.totalDebit - result.totalCredit).toBeCloseTo(1000, 5);
  });
});
