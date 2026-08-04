import { describe, expect, it } from "vitest";
import { buildBudgetVarianceExplanation, buildCashFlowCommentary, buildFinancialNarrative, buildProfitabilityCommentary } from "./narrative-engine";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";

function incomeStatement(overrides: Partial<IncomeStatement> = {}): IncomeStatement {
  return {
    periodStart: "2026-05-01", periodEnd: "2026-05-31",
    revenue: { label: "Revenue", lines: [], total: 100000 },
    costOfSales: { label: "Cost of Sales", lines: [], total: 40000 },
    grossProfit: 60000,
    operatingExpenses: { label: "Operating Expenses", lines: [], total: 15000 },
    operatingProfit: 45000,
    otherIncome: { label: "Other Income", lines: [], total: 0 },
    otherExpense: { label: "Other Expense", lines: [], total: 0 },
    netProfit: 45000,
    ...overrides,
  };
}

function balanceSheet(overrides: Partial<BalanceSheet> = {}): BalanceSheet {
  return { asOfDate: "2026-05-31", assets: { label: "Assets", lines: [], total: 100000 }, liabilities: { label: "Liabilities", lines: [], total: 40000 }, equity: { label: "Equity", lines: [], total: 60000 }, totalAssets: 100000, totalLiabilitiesAndEquity: 100000, isBalanced: true, ...overrides };
}

function cashFlow(overrides: Partial<CashFlowStatement> = {}): CashFlowStatement {
  return { periodStart: "2026-05-01", periodEnd: "2026-05-31", operatingActivities: { label: "Operating", lines: [], total: 10000 }, investingActivities: { label: "Investing", lines: [], total: 0 }, financingActivities: { label: "Financing", lines: [], total: 0 }, netChangeInCash: 10000, actualCashMovement: 10000, reconciliationVariance: 0, openingCash: 50000, closingCash: 60000, ...overrides };
}

describe("buildFinancialNarrative", () => {
  it("uses the caller-supplied title for any period-summary narrative type", () => {
    const narrative = buildFinancialNarrative("Month-End Summary — May 2026", incomeStatement(), incomeStatement({ revenue: { label: "Revenue", lines: [], total: 80000 }, netProfit: 30000 }), balanceSheet(), cashFlow());
    expect(narrative.title).toBe("Month-End Summary — May 2026");
    expect(narrative.interpretations.some((i) => i.includes("grew"))).toBe(true);
  });

  it("flags an unbalanced Balance Sheet as an interpretation, not a silent fact", () => {
    const narrative = buildFinancialNarrative("Test", incomeStatement(), incomeStatement(), balanceSheet({ isBalanced: false }), cashFlow());
    expect(narrative.interpretations.some((i) => i.includes("does not currently balance"))).toBe(true);
  });

  it("separates facts from interpretations", () => {
    const narrative = buildFinancialNarrative("Test", incomeStatement(), incomeStatement(), balanceSheet(), cashFlow());
    expect(narrative.facts.length).toBeGreaterThan(0);
    expect(narrative.facts.every((f) => !f.includes("grew") && !f.includes("declined"))).toBe(true);
  });
});

describe("buildCashFlowCommentary", () => {
  it("flags negative operating cash flow", () => {
    const narrative = buildCashFlowCommentary(cashFlow({ operatingActivities: { label: "Operating", lines: [], total: -5000 } }));
    expect(narrative.interpretations.some((i) => i.includes("consumed cash"))).toBe(true);
  });
});

describe("buildBudgetVarianceExplanation", () => {
  it("flags material variances only", () => {
    const narrative = buildBudgetVarianceExplanation([
      { accountCode: "4000", description: "Sales", budget: 100000, actual: 120000, variance: 20000, variancePercent: 20 },
      { accountCode: "6100", description: "Rent", budget: 10000, actual: 10200, variance: 200, variancePercent: 2 },
    ]);
    expect(narrative.interpretations).toHaveLength(1);
    expect(narrative.interpretations[0]).toContain("4000");
  });

  it("honestly reports no budgets set", () => {
    const narrative = buildBudgetVarianceExplanation([]);
    expect(narrative.facts[0]).toContain("No budgets");
  });
});

describe("buildProfitabilityCommentary", () => {
  it("reports margin improvement", () => {
    const narrative = buildProfitabilityCommentary(incomeStatement({ grossProfit: 70000 }), incomeStatement({ grossProfit: 50000 }));
    expect(narrative.interpretations.some((i) => i.includes("improved"))).toBe(true);
  });

  it("flags low gross margin", () => {
    const narrative = buildProfitabilityCommentary(incomeStatement({ grossProfit: 20000 }), incomeStatement({ grossProfit: 20000 }));
    expect(narrative.interpretations.some((i) => i.includes("below 30%"))).toBe(true);
  });
});
