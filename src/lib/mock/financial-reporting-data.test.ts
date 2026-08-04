import { describe, expect, it } from "vitest";
import { MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT, MOCK_INCOME_STATEMENT } from "./financial-reporting-data";

describe("financial-reporting-data mock statements", () => {
  it("produces a Balance Sheet that actually balances", () => {
    expect(MOCK_BALANCE_SHEET.isBalanced).toBe(true);
  });

  it("produces a Cash Flow Statement with zero reconciliation variance", () => {
    expect(MOCK_CASH_FLOW_STATEMENT.reconciliationVariance).toBe(0);
  });

  it("produces an Income Statement with a positive Net Profit for the mock trading period", () => {
    expect(MOCK_INCOME_STATEMENT.netProfit).toBeGreaterThan(0);
  });
});
