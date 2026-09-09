import { describe, expect, it } from "vitest";
import {
  answerBankingWarnings,
  answerBiggestRisks,
  answerCashConcernWhy,
  answerCashFlowMovements,
  answerCashFlowPressure,
  answerCashStatus,
  answerCustomersPayingLate,
  answerDataQualityWarnings,
  answerDealWithFirst,
  answerGlIssues,
  answerHighestCreditRisk,
  answerInventoryIncrease,
  answerJournalsForBalance,
  answerMainRisks,
  answerMissingData,
  answerNeedsAttention,
  answerNextActions,
  answerProfitDecrease,
  answerProfitabilityActions,
  answerProfitabilityStatus,
  answerRelatedWarnings,
  answerSituationsAttention,
  answerSupplierPaymentsAttention,
  answerSupplierRenegotiation,
  answerUnmatched,
  answerVatIssues,
  answerVyronAiUnavailable,
  answerWhatChanged,
  matchCopilotQuestion,
  SUPPORTED_COPILOT_QUESTIONS,
  toCopilotAnswerFromVyronAi,
  type AskableFinding,
} from "./copilot-assistant-engine";
import type { VyronAiStructuredResponse } from "@/server/ai/types";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { ForecastResult } from "@/server/reporting/forecast-engine";
import type { BusinessSituation } from "@/server/financial-intelligence/types";

// Number punctuation is locale-dependent — assert on the currency-
// grouping behavior, not a hardcoded English separator (matches this
// codebase's own `bank-accounts/page.test.ts::fmt` convention).
function fmt(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

// ---------------------------------------------------------------------
// VYRON Ask (Phase 12) — grounded in Finding[].
// ---------------------------------------------------------------------

function finding(overrides: Partial<AskableFinding> & Pick<AskableFinding, "category" | "severity" | "title">): AskableFinding {
  return {
    description: "Test description",
    evidence: "Test evidence",
    recommendedAction: "Test action",
    actionHref: "/company/co_1/dashboard",
    ...overrides,
  };
}

describe("matchCopilotQuestion — VYRON Ask questions", () => {
  it("matches every VYRON Ask example prompt from the brief to exactly the intended question, unambiguously", () => {
    expect(matchCopilotQuestion("What needs my attention?")).toBe("needs-attention");
    expect(matchCopilotQuestion("Why are there banking warnings?")).toBe("banking-warnings");
    expect(matchCopilotQuestion("What should I do next?")).toBe("next-actions");
    expect(matchCopilotQuestion("Show me my biggest financial risks.")).toBe("biggest-risks");
    expect(matchCopilotQuestion("Why is my company showing Data Quality warnings?")).toBe("data-quality-warnings");
  });

  it("matches every Phase 13 example prompt from the brief to exactly the intended question, unambiguously", () => {
    expect(matchCopilotQuestion("What is happening with my cash?")).toBe("cash-status");
    expect(matchCopilotQuestion("Are customers paying late?")).toBe("customers-paying-late");
    expect(matchCopilotQuestion("Do I have supplier payments that need attention?")).toBe("supplier-payments-attention");
    expect(matchCopilotQuestion("How is profitability looking?")).toBe("profitability-status");
    expect(matchCopilotQuestion("What GL issues has VYRON found?")).toBe("gl-issues");
    expect(matchCopilotQuestion("What VAT issues need attention?")).toBe("vat-issues");
    expect(matchCopilotQuestion("What data is missing from my financial picture?")).toBe("missing-data");
  });

  it("matches every catalog entry's own label back to its own id — every question's exact wording is unambiguous against the full catalog", () => {
    for (const q of SUPPORTED_COPILOT_QUESTIONS) {
      expect(matchCopilotQuestion(q.label)).toBe(q.id);
    }
  });

  it("matches every Phase 14 Business Situation example prompt from the brief to exactly the intended question, unambiguously", () => {
    expect(matchCopilotQuestion("What situations need my attention?")).toBe("situations-attention");
    expect(matchCopilotQuestion("Are any of the warnings related?")).toBe("related-warnings");
    expect(matchCopilotQuestion("Why is VYRON concerned about cash?")).toBe("cash-concern-why");
    expect(matchCopilotQuestion("What are the main risks in my business?")).toBe("main-risks");
    expect(matchCopilotQuestion("What should I deal with first?")).toBe("deal-with-first");
  });

  it("routes 'What are my biggest financial problems?' to the existing biggest-risks question — no new catalog entry needed", () => {
    expect(matchCopilotQuestion("What are my biggest financial problems?")).toBe("biggest-risks");
  });

  it("still routes each Phase 12/13 question's own phrasing correctly now that the catalog has grown (no regression from the Phase 14 additions)", () => {
    expect(matchCopilotQuestion("What needs my attention?")).toBe("needs-attention");
    expect(matchCopilotQuestion("What is happening with my cash?")).toBe("cash-status");
    expect(matchCopilotQuestion("Show me my biggest financial risks.")).toBe("biggest-risks");
    expect(matchCopilotQuestion("What should I do next?")).toBe("next-actions");
  });
});

describe("answerNeedsAttention", () => {
  it("says nothing needs attention when there are no findings (negative condition)", () => {
    const answer = answerNeedsAttention([]);
    expect(answer.executiveSummary).toContain("Nothing currently needs your attention");
    expect(answer.actionLinks).toEqual([]);
  });

  it("names the single most severe finding first with real evidence (positive condition)", () => {
    const findings = [
      finding({ category: "VAT", severity: "Medium", title: "VAT liability exists", evidence: "R 100 VAT payable." }),
      finding({ category: "Banking", severity: "Critical", title: "3 possible duplicates detected", evidence: "3 open exceptions." }),
    ];
    const answer = answerNeedsAttention(findings);
    expect(answer.executiveSummary).toContain("[Critical] 3 possible duplicates detected");
    expect(answer.evidence).toContain("3 open exceptions.");
  });

  it("lists multiple findings together, most severe first (multiple simultaneous findings)", () => {
    const findings = [
      finding({ category: "VAT", severity: "Low", title: "Low item" }),
      finding({ category: "Banking", severity: "Critical", title: "Critical item" }),
      finding({ category: "Customers", severity: "High", title: "High item" }),
    ];
    const answer = answerNeedsAttention(findings);
    expect(answer.keyPoints).toEqual(["[Critical] Critical item", "[High] High item", "[Low] Low item"]);
  });

  it("only ever surfaces a real recommendedAction/actionHref pair — never a fabricated route", () => {
    const findings = [finding({ category: "Banking", severity: "High", title: "A finding", recommendedAction: "Review Banking", actionHref: "/company/co_1/banking-accounts" })];
    const answer = answerNeedsAttention(findings);
    expect(answer.actionLinks).toEqual([{ label: "Review Banking", href: "/company/co_1/banking-accounts" }]);
  });
});

describe("answerBankingWarnings", () => {
  it("says there are no banking warnings when there are none, even if other findings exist (question with no relevant findings)", () => {
    const answer = answerBankingWarnings([finding({ category: "VAT", severity: "High", title: "VAT item" })]);
    expect(answer.executiveSummary).toBe("There are no banking warnings right now.");
    expect(answer.evidence).toEqual([]);
  });

  it("cites the real flagged banking findings with their evidence (matches the brief's own example shape)", () => {
    const findings = [
      finding({ category: "Banking", severity: "High", title: "2 possible duplicates detected", evidence: "2 open PossibleDuplicate exception(s)." }),
      finding({ category: "Banking", severity: "High", title: "1 large unusual payment detected", evidence: "1 open LargeUnusualPayment exception(s)." }),
      finding({ category: "VAT", severity: "Medium", title: "Unrelated VAT item" }),
    ];
    const answer = answerBankingWarnings(findings);
    expect(answer.executiveSummary).toBe("VYRON has flagged 2 banking finding(s): 2 possible duplicates detected; 1 large unusual payment detected.");
    expect(answer.evidence).toEqual(["2 open PossibleDuplicate exception(s).", "1 open LargeUnusualPayment exception(s)."]);
    expect(answer.evidence.every((e) => e.length > 0)).toBe(true);
  });
});

describe("answerNextActions", () => {
  it("says there's nothing to act on when there are no findings at all (insufficient data)", () => {
    const answer = answerNextActions([]);
    expect(answer.executiveSummary).toBe("There's nothing to act on right now — no active findings.");
  });

  it("distinguishes 'nothing actionable' from 'nothing at all' when findings exist but none are actionable", () => {
    const answer = answerNextActions([finding({ category: "DataQuality", severity: "Medium", title: "Informational", recommendedAction: null, actionHref: null })]);
    expect(answer.executiveSummary).toBe("There's nothing actionable right now — every active finding is informational.");
  });

  it("leads with the single most severe actionable finding's real recommended action", () => {
    const findings = [
      finding({ category: "VAT", severity: "Medium", title: "Medium item", recommendedAction: "Review VAT", actionHref: "/company/co_1/vat" }),
      finding({ category: "Banking", severity: "Critical", title: "Critical item", recommendedAction: "Review Banking Exceptions", actionHref: "/company/co_1/banking-exceptions" }),
    ];
    const answer = answerNextActions(findings);
    expect(answer.executiveSummary).toBe("Start with: Review Banking Exceptions (Critical item).");
    expect(answer.actionLinks?.[0]).toEqual({ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" });
  });
});

describe("answerDataQualityWarnings", () => {
  it("confirms a complete picture when there are no Data Quality findings (negative condition)", () => {
    const answer = answerDataQualityWarnings([finding({ category: "Banking", severity: "High", title: "Banking item" })]);
    expect(answer.executiveSummary).toContain("no Data Quality warnings");
  });

  it("uses reassuring, non-alarming language and never claims a financial problem (Data Quality presentation)", () => {
    const findings = [finding({ category: "DataQuality", severity: "Medium", title: "No bank transactions have been imported yet" })];
    const answer = answerDataQualityWarnings(findings);
    expect(answer.executiveSummary).toContain("don't mean something is financially wrong");
    expect(answer.executiveSummary).not.toMatch(/cash flow (is|looks)/i);
    expect(answer.alternativeExplanations[0]).toContain("not business performance");
  });

  it("lists every real Data Quality finding's own title as evidence — no invented explanation", () => {
    const findings = [
      finding({ category: "DataQuality", severity: "Medium", title: "No customers have been added yet", evidence: "0 customers found." }),
      finding({ category: "DataQuality", severity: "Medium", title: "No suppliers have been added yet", evidence: "0 suppliers found." }),
    ];
    const answer = answerDataQualityWarnings(findings);
    expect(answer.keyPoints).toEqual(["No customers have been added yet", "No suppliers have been added yet"]);
    expect(answer.evidence).toEqual(["0 customers found.", "0 suppliers found."]);
  });
});

// ---------------------------------------------------------------------
// Phase 13 — expanded Financial Intelligence questions.
// ---------------------------------------------------------------------

describe("answerCustomersPayingLate", () => {
  it("reports no concern when there are no Customer findings, even if other findings exist (question with no relevant findings)", () => {
    const answer = answerCustomersPayingLate([finding({ category: "Banking", severity: "High", title: "Banking item" })]);
    expect(answer.executiveSummary).toContain("No customers currently show a payment concern");
    expect(answer.evidence).toEqual([]);
  });

  it("cites the real flagged Customer findings with their evidence (positive condition)", () => {
    const findings = [finding({ category: "Customers", severity: "High", title: "Customer balance overdue", evidence: "R 15,000.00 overdue by more than 90 days." })];
    const answer = answerCustomersPayingLate(findings);
    expect(answer.executiveSummary).toContain("Customer balance overdue");
    expect(answer.evidence).toEqual(["R 15,000.00 overdue by more than 90 days."]);
  });

  it("orders multiple Customer findings most-severe-first (multiple simultaneous findings / severity)", () => {
    const findings = [
      finding({ category: "Customers", severity: "Medium", title: "Slow payer" }),
      finding({ category: "Customers", severity: "High", title: "Overdue balance" }),
    ];
    expect(answerCustomersPayingLate(findings).keyPoints).toEqual(["[High] Overdue balance", "[Medium] Slow payer"]);
  });
});

describe("answerSupplierPaymentsAttention", () => {
  it("reports nothing needing attention when there are no Supplier findings (negative condition)", () => {
    const answer = answerSupplierPaymentsAttention([]);
    expect(answer.executiveSummary).toBe("No supplier payments currently need attention.");
  });

  it("cites the real flagged Supplier finding with a real action link (recommended action rendering)", () => {
    const findings = [finding({ category: "Suppliers", severity: "High", title: "Supplier balance overdue", recommendedAction: "Review Supplier Aging", actionHref: "/company/co_1/suppliers" })];
    const answer = answerSupplierPaymentsAttention(findings);
    expect(answer.actionLinks).toEqual([{ label: "Review Supplier Aging", href: "/company/co_1/suppliers" }]);
  });
});

describe("answerVatIssues", () => {
  it("reports nothing when there are no VAT findings (empty data)", () => {
    expect(answerVatIssues([]).executiveSummary).toBe("No VAT issues currently need attention.");
  });

  it("escalates correctly when a Critical VAT finding is present (boundary via real severity passthrough)", () => {
    const findings = [finding({ category: "VAT", severity: "Critical", title: "5 VAT exceptions require review" })];
    const answer = answerVatIssues(findings);
    expect(answer.keyPoints).toEqual(["[Critical] 5 VAT exceptions require review"]);
  });
});

describe("answerGlIssues", () => {
  it("reports no issues when there are no GeneralLedger findings (negative condition)", () => {
    expect(answerGlIssues([]).executiveSummary).toContain("hasn't found any General Ledger issues");
  });

  it("cites the real flagged GeneralLedger finding (positive condition)", () => {
    const findings = [finding({ category: "GeneralLedger", severity: "Medium", title: "Journal JNL-005 stuck as Draft", evidence: "JNL-005 — Draft for 15 day(s)." })];
    const answer = answerGlIssues(findings);
    expect(answer.executiveSummary).toContain("Journal JNL-005 stuck as Draft");
    expect(answer.evidence).toEqual(["JNL-005 — Draft for 15 day(s)."]);
  });

  it("only ever reports the real GeneralLedger category, never mixing in Banking/Transactions findings", () => {
    const findings = [finding({ category: "GeneralLedger", severity: "Medium", title: "GL item" }), finding({ category: "Transactions", severity: "High", title: "Unrelated transaction item" })];
    const answer = answerGlIssues(findings);
    expect(answer.keyPoints).toEqual(["[Medium] GL item"]);
  });
});

describe("answerCashStatus", () => {
  it("says it can't answer yet when totalCash wasn't supplied (insufficient data)", () => {
    const answer = answerCashStatus([], null);
    expect(answer.confidence).toBe(0);
    expect(answer.executiveSummary).toContain("Not answerable yet");
  });

  it("states the real total cash figure even with no findings flagged (positive condition, informational)", () => {
    const answer = answerCashStatus([], 42000);
    expect(answer.executiveSummary).toContain(fmt(42000));
    expect(answer.evidence[0]).toBe(`Total cash: ${fmt(42000)}.`);
  });

  it("combines the real total cash figure with real CashFlow findings when present", () => {
    const findings = [finding({ category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." })];
    const answer = answerCashStatus(findings, -500);
    expect(answer.executiveSummary).toContain("Cash balance is negative");
    expect(answer.keyPoints).toEqual(["[Critical] Cash balance is negative"]);
  });

  it("never claims a trend from a single point-in-time balance", () => {
    const answer = answerCashStatus([], 1000);
    expect(answer.executiveSummary.toLowerCase()).not.toMatch(/declin|improv|trend|deteriorat/);
  });
});

describe("answerProfitabilityStatus", () => {
  it("says it can't answer yet when netProfit wasn't supplied (insufficient data)", () => {
    const answer = answerProfitabilityStatus([], null);
    expect(answer.confidence).toBe(0);
    expect(answer.executiveSummary).toContain("Not answerable yet");
  });

  it("states the real net profit figure even with no findings flagged (positive condition, informational)", () => {
    const answer = answerProfitabilityStatus([], 8000);
    expect(answer.executiveSummary).toContain(fmt(8000));
  });

  it("combines the real net profit figure with real Profitability findings when present", () => {
    const findings = [finding({ category: "Profitability", severity: "High", title: "Net loss this period" })];
    const answer = answerProfitabilityStatus(findings, -300);
    expect(answer.executiveSummary).toContain("Net loss this period");
  });

  it("never claims a trend from a single period's figure (no false trend analysis)", () => {
    const answer = answerProfitabilityStatus([], 100);
    expect(answer.executiveSummary.toLowerCase()).not.toMatch(/falling|declin|improv|trend/);
  });
});

// ---------------------------------------------------------------------
// Phase 14 — Business Situation-aware questions. Grounded in
// business-situation-engine.ts::buildBusinessSituations — every builder
// below only reads/restates a real BusinessSituation, never computes a
// new relationship or numeric risk score.
// ---------------------------------------------------------------------

/** Full `Finding` fixtures for `BusinessSituation.contributingFindings`
 * — distinct from this file's own `finding()` (an `AskableFinding`,
 * which lacks `id`/`source`), since a situation always carries the real
 * underlying `Finding` objects. */
function situationFinding(overrides: Partial<import("@/server/financial-intelligence/types").Finding> & Pick<import("@/server/financial-intelligence/types").Finding, "id" | "category" | "severity" | "title">) {
  return {
    description: "Test description",
    evidence: "Test evidence",
    recommendedAction: "Test action",
    actionHref: "/company/co_1/dashboard",
    source: "Deterministic" as const,
    ...overrides,
  };
}

function situation(overrides: Partial<BusinessSituation> & Pick<BusinessSituation, "id" | "title" | "contributingFindings">): BusinessSituation {
  return {
    summary: "VYRON identified two related conditions: a test condition and another test condition.",
    severity: "High",
    category: "WorkingCapital",
    evidence: overrides.contributingFindings.map((f) => f.evidence),
    recommendedActions: [],
    ...overrides,
  };
}

describe("answerSituationsAttention", () => {
  it("reports no related conditions when there are none (no situations)", () => {
    const answer = answerSituationsAttention([]);
    expect(answer.executiveSummary).toContain("hasn't identified any related conditions");
    expect(answer.keyPoints).toEqual([]);
  });

  it("leads with the single most significant situation, honestly framed as related-not-causal (one valid situation)", () => {
    const cash = situationFinding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
    const customers = situationFinding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue", evidence: "R 15,000.00 overdue by more than 90 days." });
    const situations = [situation({ id: "situation-cash-collection-pressure", title: "Cash Collection Pressure", severity: "Critical", contributingFindings: [cash, customers] })];
    const answer = answerSituationsAttention(situations);
    expect(answer.executiveSummary).toContain('"Cash Collection Pressure"');
    expect(answer.executiveSummary).toContain("not a claim that one caused another");
    expect(answer.evidence).toEqual(["Total cash: R -500.00.", "R 15,000.00 overdue by more than 90 days."]);
  });

  it("lists multiple simultaneous situations with their contributing-finding counts (multiple situations)", () => {
    const a = situationFinding({ id: "a", category: "CashFlow", severity: "Critical", title: "A" });
    const b = situationFinding({ id: "b", category: "Customers", severity: "High", title: "B" });
    const c = situationFinding({ id: "c", category: "Suppliers", severity: "High", title: "C" });
    const situations = [
      situation({ id: "s1", title: "Situation One", severity: "Critical", contributingFindings: [a, b] }),
      situation({ id: "s2", title: "Situation Two", severity: "High", contributingFindings: [b, c] }),
    ];
    const answer = answerSituationsAttention(situations);
    expect(answer.keyPoints).toEqual(["[Critical] Situation One — 2 related finding(s)", "[High] Situation Two — 2 related finding(s)"]);
  });

  it("deduplicates real recommended actions shared by two situations (duplicate actions)", () => {
    const a = situationFinding({ id: "a", category: "Banking", severity: "High", title: "A" });
    const b = situationFinding({ id: "b", category: "Banking", severity: "High", title: "B" });
    const situations = [
      situation({ id: "s1", title: "S1", contributingFindings: [a], recommendedActions: [{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }] }),
      situation({ id: "s2", title: "S2", contributingFindings: [b], recommendedActions: [{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }] }),
    ];
    const answer = answerSituationsAttention(situations);
    expect(answer.actionLinks).toEqual([{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }]);
  });
});

describe("answerRelatedWarnings", () => {
  it("honestly says no, when no situations were identified (unrelated findings / no false correlations)", () => {
    const answer = answerRelatedWarnings([]);
    expect(answer.executiveSummary).toMatch(/^No —/);
  });

  it("says yes and names the real related conditions when situations exist (related findings)", () => {
    const a = situationFinding({ id: "a", category: "Banking", severity: "High", title: "Possible duplicate" });
    const b = situationFinding({ id: "b", category: "Banking", severity: "High", title: "Large unusual payment" });
    const situations = [situation({ id: "s", title: "Elevated Payment Review Activity", contributingFindings: [a, b] })];
    const answer = answerRelatedWarnings(situations);
    expect(answer.executiveSummary).toMatch(/^Yes —/);
    expect(answer.executiveSummary).toContain("Elevated Payment Review Activity");
    expect(answer.executiveSummary).toContain("not one causing another");
    expect(answer.keyPoints).toEqual(["Elevated Payment Review Activity: Possible duplicate + Large unusual payment"]);
  });
});

describe("answerCashConcernWhy", () => {
  it("honestly says it isn't concerned when there are no CashFlow findings (negative condition)", () => {
    const answer = answerCashConcernWhy([], [], 42000);
    expect(answer.executiveSummary).toContain("isn't currently concerned about cash");
    expect(answer.executiveSummary).toContain(fmt(42000));
  });

  it("says it can't state a total when totalCash is null but still reports honestly (insufficient data)", () => {
    const answer = answerCashConcernWhy([], [], null);
    expect(answer.executiveSummary).toContain("isn't currently concerned about cash");
    expect(answer.executiveSummary).not.toContain("R ");
  });

  it("cites the real CashFlow finding and total cash figure when concerned (positive condition)", () => {
    const findings = [finding({ category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." })];
    const answer = answerCashConcernWhy(findings, [], -500);
    expect(answer.executiveSummary).toContain("Cash balance is negative");
    expect(answer.executiveSummary).toContain(fmt(-500));
  });

  it("mentions the broader situation, non-causally, when a related Business Situation touches cash (evidence chain)", () => {
    const cash = situationFinding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
    const customers = situationFinding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue" });
    const situations = [situation({ id: "situation-cash-collection-pressure", title: "Cash Collection Pressure", contributingFindings: [cash, customers] })];
    const findings = [finding({ category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." })];
    const answer = answerCashConcernWhy(findings, situations, -500);
    expect(answer.executiveSummary).toContain("Cash Collection Pressure");
    expect(answer.alternativeExplanations[0]).toContain("observed together, not that one caused the other");
  });
});

describe("answerMainRisks", () => {
  it("reports no risks when there are no findings (empty data)", () => {
    const answer = answerMainRisks([], []);
    expect(answer.executiveSummary).toContain("no active findings");
  });

  it("leads with the single most severe finding (severity handling)", () => {
    const findings = [
      finding({ category: "VAT", severity: "Medium", title: "Medium item" }),
      finding({ category: "Banking", severity: "Critical", title: "Critical item" }),
    ];
    const answer = answerMainRisks(findings, []);
    expect(answer.executiveSummary).toContain("[Critical] Critical item");
    expect(answer.executiveSummary).not.toContain("related condition");
  });

  it("mentions related situations exist, without claiming causation, when situations were identified (no false correlations)", () => {
    const a = situationFinding({ id: "a", category: "CashFlow", severity: "Critical", title: "A" });
    const b = situationFinding({ id: "b", category: "Customers", severity: "High", title: "B" });
    const findings = [finding({ category: "CashFlow", severity: "Critical", title: "A" })];
    const situations = [situation({ id: "s", title: "S", contributingFindings: [a, b] })];
    const answer = answerMainRisks(findings, situations);
    expect(answer.executiveSummary).toContain("1 related condition(s)");
  });
});

describe("answerDealWithFirst", () => {
  it("says there's nothing to deal with when there are no findings and no situations (no situations, empty data)", () => {
    const answer = answerDealWithFirst([], []);
    expect(answer.executiveSummary).toBe("There's nothing to deal with right now — no active findings.");
  });

  it("distinguishes 'nothing actionable' from 'nothing at all' when findings exist but none are actionable", () => {
    const answer = answerDealWithFirst([finding({ category: "DataQuality", severity: "Medium", title: "Informational", recommendedAction: null, actionHref: null })], []);
    expect(answer.executiveSummary).toBe("There's nothing actionable to deal with first — every active finding is informational.");
  });

  it("falls back to the single most severe actionable finding when no situation exists (deterministic prioritization, fallback path)", () => {
    const findings = [
      finding({ category: "VAT", severity: "Medium", title: "Medium item", recommendedAction: "Review VAT", actionHref: "/company/co_1/vat" }),
      finding({ category: "Banking", severity: "Critical", title: "Critical item", recommendedAction: "Review Banking Exceptions", actionHref: "/company/co_1/banking-exceptions" }),
    ];
    const answer = answerDealWithFirst(findings, []);
    expect(answer.executiveSummary).toBe('Deal with "Critical item" first: Review Banking Exceptions.');
  });

  it("prioritizes the first Business Situation over a standalone finding when one exists (deterministic prioritization, situation path)", () => {
    const cash = situationFinding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative" });
    const customers = situationFinding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue" });
    const findings = [finding({ category: "VAT", severity: "Low", title: "Unrelated low item", recommendedAction: "Review VAT", actionHref: "/company/co_1/vat" })];
    const situations = [
      situation({
        id: "situation-cash-collection-pressure",
        title: "Cash Collection Pressure",
        contributingFindings: [cash, customers],
        recommendedActions: [{ label: "Review Customer Aging", href: "/company/co_1/customers" }],
      }),
    ];
    const answer = answerDealWithFirst(findings, situations);
    expect(answer.executiveSummary).toContain('Deal with "Cash Collection Pressure" first');
    expect(answer.actionLinks).toEqual([{ label: "Review Customer Aging", href: "/company/co_1/customers" }]);
  });
});

describe("answerMissingData", () => {
  it("delegates to the real Data Quality findings but echoes the question actually asked", () => {
    const findings = [finding({ category: "DataQuality", severity: "Medium", title: "No suppliers have been added yet", evidence: "0 suppliers found." })];
    const answer = answerMissingData(findings);
    expect(answer.questionId).toBe("missing-data");
    expect(answer.question).toBe("What data is missing from my financial picture?");
    expect(answer.evidence).toEqual(["0 suppliers found."]);
  });

  it("reports completeness honestly when there is nothing missing (negative condition)", () => {
    const answer = answerMissingData([]);
    expect(answer.executiveSummary).toContain("complete");
  });
});

// ---------------------------------------------------------------------
// Phase 15 — VYRON AI mapping/fallback.
// ---------------------------------------------------------------------

function vyronAiResponse(overrides: Partial<VyronAiStructuredResponse> = {}): VyronAiStructuredResponse {
  return {
    answer: "VYRON found a negative cash balance.",
    keyPoints: ["Cash balance is negative"],
    evidenceReferences: [{ label: "VYRON Intelligence — Cash Flow", href: "/company/co_1/intelligence" }],
    recommendedActions: [{ label: "Review Banking", href: "/company/co_1/bank-accounts" }],
    uncertainties: [],
    ...overrides,
  };
}

describe("toCopilotAnswerFromVyronAi", () => {
  it("maps the real question text, answer, keyPoints, evidenceReferences, actions, and uncertainties straight through", () => {
    const result = toCopilotAnswerFromVyronAi("Why is VYRON worried about cash?", vyronAiResponse({ uncertainties: ["Not fully certain."] }));
    expect(result.question).toBe("Why is VYRON worried about cash?");
    expect(result.executiveSummary).toBe("VYRON found a negative cash balance.");
    expect(result.keyPoints).toEqual(["Cash balance is negative"]);
    expect(result.evidenceReferences).toEqual([{ label: "VYRON Intelligence — Cash Flow", href: "/company/co_1/intelligence" }]);
    expect(result.actionLinks).toEqual([{ label: "Review Banking", href: "/company/co_1/bank-accounts" }]);
    expect(result.uncertainties).toEqual(["Not fully certain."]);
  });

  it("tags the answer answeredBy: VyronAI", () => {
    expect(toCopilotAnswerFromVyronAi("q", vyronAiResponse()).answeredBy).toBe("VyronAI");
  });

  it("never invents a raw evidence string — evidence stays empty, only evidenceReferences carries VYRON AI's citations", () => {
    expect(toCopilotAnswerFromVyronAi("q", vyronAiResponse()).evidence).toEqual([]);
  });
});

describe("answerVyronAiUnavailable", () => {
  it("honestly says VYRON AI is unavailable and points back to the deterministic catalog (provider failure fallback)", () => {
    const answer = answerVyronAiUnavailable("What's worrying you most?");
    expect(answer.executiveSummary).toContain("VYRON AI is temporarily unavailable");
    expect(answer.executiveSummary).toContain(`${SUPPORTED_COPILOT_QUESTIONS.length}`);
    expect(answer.answeredBy).toBe("VyronAI");
    expect(answer.confidence).toBe(0);
  });

  it("echoes the real question text the user asked", () => {
    expect(answerVyronAiUnavailable("Why is VYRON concerned?").question).toBe("Why is VYRON concerned?");
  });
});
