import { describe, expect, it } from "vitest";
import {
  answerBiggestRisks,
  answerCashFlowMovements,
  answerCashFlowPressure,
  answerHighestCreditRisk,
  answerInventoryIncrease,
  answerJournalsForBalance,
  answerProfitDecrease,
  answerProfitabilityActions,
  answerSupplierRenegotiation,
  answerUnmatched,
  answerWhatChanged,
  matchCopilotQuestion,
} from "./copilot-assistant-engine";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { ForecastResult } from "@/server/reporting/forecast-engine";

function incomeStatement(overrides: Partial<IncomeStatement> = {}): IncomeStatement {
  return {
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    revenue: { label: "Revenue", lines: [{ accountId: 1, accountCode: "4000", description: "Sales", reportingGroup: "", amount: 100000 }], total: 100000 },
    costOfSales: { label: "Cost of Sales", lines: [{ accountId: 2, accountCode: "5000", description: "Purchases", reportingGroup: "", amount: 40000 }], total: 40000 },
    grossProfit: 60000,
    operatingExpenses: { label: "Operating Expenses", lines: [{ accountId: 3, accountCode: "6100", description: "Rent", reportingGroup: "", amount: 15000 }], total: 15000 },
    operatingProfit: 45000,
    otherIncome: { label: "Other Income", lines: [], total: 0 },
    otherExpense: { label: "Other Expense", lines: [], total: 0 },
    netProfit: 45000,
    ...overrides,
  };
}

describe("matchCopilotQuestion", () => {
  it("matches free text to a supported question", () => {
    expect(matchCopilotQuestion("Why did profit decrease this month")).toBe("profit-decrease");
    expect(matchCopilotQuestion("explain the cash flow movements please")).toBe("cash-flow-movements");
  });

  it("returns null with no keyword overlap", () => {
    expect(matchCopilotQuestion("what time is it")).toBeNull();
  });
});

describe("answerProfitDecrease", () => {
  it("identifies the largest contributing movements when profit fell", () => {
    const prior = incomeStatement();
    const current = incomeStatement({ netProfit: 30000, operatingExpenses: { label: "Operating Expenses", lines: [{ accountId: 3, accountCode: "6100", description: "Rent", reportingGroup: "", amount: 30000 }], total: 30000 } });
    const answer = answerProfitDecrease(current, prior);
    expect(answer.executiveSummary).toContain("fell");
    expect(answer.evidence.some((e) => e.includes("6100"))).toBe(true);
  });

  it("honestly reports when profit did not decrease", () => {
    const prior = incomeStatement();
    const current = incomeStatement({ netProfit: 50000 });
    const answer = answerProfitDecrease(current, prior);
    expect(answer.executiveSummary).toContain("did not decrease");
    expect(answer.suggestedActions).toHaveLength(0);
  });
});

describe("answerCashFlowMovements", () => {
  function cashFlow(overrides: Partial<CashFlowStatement> = {}): CashFlowStatement {
    return {
      periodStart: "2026-05-01", periodEnd: "2026-05-31",
      operatingActivities: { label: "Operating", lines: [], total: 10000 },
      investingActivities: { label: "Investing", lines: [], total: 0 },
      financingActivities: { label: "Financing", lines: [], total: -2000 },
      netChangeInCash: 8000, actualCashMovement: 8000, reconciliationVariance: 0, openingCash: 50000, closingCash: 58000,
      ...overrides,
    };
  }

  it("gives high confidence when reconciliation variance is zero", () => {
    expect(answerCashFlowMovements(cashFlow()).confidence).toBe(0.95);
  });

  it("gives lower confidence and flags the variance when non-zero", () => {
    const answer = answerCashFlowMovements(cashFlow({ reconciliationVariance: 500 }));
    expect(answer.confidence).toBe(0.6);
    expect(answer.suggestedActions.length).toBeGreaterThan(0);
  });
});

describe("answerHighestCreditRisk", () => {
  it("ranks customers by overdue amount", () => {
    const answer = answerHighestCreditRisk([
      { customerId: 1, customerName: "Alpha", outstandingBalance: 5000, overdueAmount: 1000, averagePaymentDays: 40 },
      { customerId: 2, customerName: "Beta", outstandingBalance: 20000, overdueAmount: 15000, averagePaymentDays: 90 },
    ]);
    expect(answer.executiveSummary).toContain("Beta");
  });

  it("honestly reports a clean book with no overdue customers", () => {
    const answer = answerHighestCreditRisk([{ customerId: 1, customerName: "Alpha", outstandingBalance: 5000, overdueAmount: 0, averagePaymentDays: 20 }]);
    expect(answer.executiveSummary).toContain("No customers");
  });
});

describe("answerSupplierRenegotiation", () => {
  it("flags a supplier above the concentration threshold", () => {
    const answer = answerSupplierRenegotiation([{ supplierId: 1, supplierName: "MegaCorp", lifetimePurchases: 500000, sharePercent: 55 }], 20);
    expect(answer.executiveSummary).toContain("MegaCorp");
  });

  it("reports no concentrated target when nothing crosses the threshold", () => {
    const answer = answerSupplierRenegotiation([{ supplierId: 1, supplierName: "Small Co", lifetimePurchases: 1000, sharePercent: 5 }], 20);
    expect(answer.executiveSummary).toContain("No supplier");
  });
});

describe("answerInventoryIncrease", () => {
  it("reports the increase with confidence derived from forecast confidence", () => {
    const answer = answerInventoryIncrease(120000, 100000, 0.8);
    expect(answer.executiveSummary).toContain("rose");
  });

  it("honestly reports when inventory did not increase", () => {
    const answer = answerInventoryIncrease(90000, 100000, 0.8);
    expect(answer.executiveSummary).toContain("did not increase");
  });
});

describe("answerJournalsForBalance", () => {
  it("lists transactions and deduplicates journals", () => {
    const answer = answerJournalsForBalance("1000", [
      { id: 1, postingDate: "2026-05-01", description: "A", debit: 100, credit: 0, journalId: 1, journalNumber: "JR000001" },
      { id: 2, postingDate: "2026-05-02", description: "B", debit: 0, credit: 40, journalId: 1, journalNumber: "JR000001" },
    ]);
    expect(answer.journalsConsulted).toHaveLength(1);
    expect(answer.transactionsConsulted).toHaveLength(2);
  });

  it("honestly reports no transactions found", () => {
    const answer = answerJournalsForBalance("1000", []);
    expect(answer.executiveSummary).toContain("No transactions");
  });
});

describe("answerWhatChanged", () => {
  function balanceSheet(overrides: Partial<BalanceSheet> = {}): BalanceSheet {
    return { asOfDate: "2026-05-31", assets: { label: "Assets", lines: [], total: 100000 }, liabilities: { label: "Liabilities", lines: [], total: 40000 }, equity: { label: "Equity", lines: [], total: 60000 }, totalAssets: 100000, totalLiabilitiesAndEquity: 100000, isBalanced: true, ...overrides };
  }

  it("reports both profit and balance sheet movement", () => {
    const answer = answerWhatChanged(incomeStatement({ netProfit: 50000 }), incomeStatement({ netProfit: 40000 }), balanceSheet({ totalAssets: 110000 }), balanceSheet({ totalAssets: 100000 }));
    expect(answer.executiveSummary).toContain("increased");
  });
});

describe("answerBiggestRisks", () => {
  it("ranks risk items by confidence", () => {
    const answer = answerBiggestRisks([
      { label: "Low risk item", confidence: 0.3, source: "VAT" },
      { label: "High risk item", confidence: 0.9, source: "Audit" },
    ]);
    expect(answer.executiveSummary).toContain("High risk item");
  });

  it("honestly reports no risks when the list is empty", () => {
    expect(answerBiggestRisks([]).executiveSummary).toContain("No significant risks");
  });
});

describe("answerCashFlowPressure", () => {
  function forecast(overrides: Partial<ForecastResult> = {}): ForecastResult {
    return { method: "linear-regression", historicalPoints: 6, confidence: 0.8, forecast: [{ period: "2026-06", value: 50000 }, { period: "2026-07", value: 40000 }], assumptions: ["a"], ...overrides };
  }

  it("flags a declining trend", () => {
    const answer = answerCashFlowPressure(forecast());
    expect(answer.suggestedActions.length).toBeGreaterThan(0);
  });

  it("does not flag an improving trend", () => {
    const answer = answerCashFlowPressure(forecast({ forecast: [{ period: "2026-06", value: 40000 }, { period: "2026-07", value: 50000 }] }));
    expect(answer.suggestedActions).toHaveLength(0);
  });

  it("honestly reports insufficient data", () => {
    const answer = answerCashFlowPressure(forecast({ forecast: [] }));
    expect(answer.confidence).toBe(0);
  });
});

describe("answerProfitabilityActions", () => {
  it("identifies the largest cost line and low gross margin", () => {
    const answer = answerProfitabilityActions(incomeStatement({ revenue: { label: "Revenue", lines: [], total: 100000 }, grossProfit: 20000 }));
    expect(answer.suggestedActions.length).toBeGreaterThan(0);
  });
});

describe("answerUnmatched", () => {
  it("never fabricates a conclusion", () => {
    const answer = answerUnmatched("what is the meaning of life");
    expect(answer.confidence).toBe(0);
  });
});
