/**
 * Preview Mode seed data for the Financial Reporting & Executive
 * Intelligence Platform (Module 9). Field shapes match the real domain
 * types exactly. Statements/forecasts/scores are computed via the real
 * production engines (`income-statement-engine.ts`,
 * `balance-sheet-engine.ts`, `cash-flow-engine.ts`,
 * `forecast-engine.ts`, `scoring-engine.ts`) from a small hand-authored
 * — but internally consistent, balanced — set of postings, exactly the
 * `MOCK_TRIAL_BALANCE` discipline `general-ledger-data.ts` already
 * established: derived, not hand-typed. A separate local posting set
 * (not the shared `MOCK_GL_TRANSACTIONS`) so this file can carry a
 * fuller Revenue/Cost of Sales story without touching data other pages
 * and tests already depend on.
 */

import type { ChartOfAccount, TrialBalanceRow } from "@/server/general-ledger/types";
import { trialBalanceRowFromRpcRow, type TrialBalanceRpcRow } from "@/server/general-ledger/mappers";
import { buildIncomeStatement, type IncomeStatement } from "@/server/reporting/income-statement-engine";
import { buildBalanceSheet, type BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import { buildCashFlowStatement, type CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import { linearRegressionForecast, type ForecastResult } from "@/server/reporting/forecast-engine";
import { computeAuditReadinessScore, computeBusinessRiskScore, computeFinancialHealthScore } from "@/server/reporting/scoring-engine";
import { computeComplianceScore } from "@/server/services/vat-summary-service";
import type { Budget, ExecutiveAlert, ReportDefinition } from "@/server/reporting/types";
import type { NormalizedIntelligenceSignal } from "@/server/services/executive-intelligence-service";
import { MOCK_CHART_OF_ACCOUNTS } from "./general-ledger-data";
import { MOCK_COMPANY } from "./financial-data";
import { MOCK_VAT_EXCEPTIONS } from "./vat-data";

const COMPANY_ID = MOCK_COMPANY.id;

// ---------------------------------------------------------------------
// A small, internally-consistent posting set: opening balances b/fwd,
// then two months of real trading (credit sales, collections, credit
// purchases, bank charges, interest). Balanced by construction — every
// entry below has an equal-and-opposite line, verified by
// `financial-reporting-data.test.ts`.
// ---------------------------------------------------------------------

type MockPosting = { accountId: number; date: string; debit: number; credit: number };

const POSTINGS: MockPosting[] = [
  // Opening balances, brought forward as of 2026-01-01.
  { accountId: 1, date: "2026-01-01", debit: 30000, credit: 0 }, // Bank
  { accountId: 6, date: "2026-01-01", debit: 0, credit: 30000 }, // Retained Income

  // April 2026 trading.
  { accountId: 2, date: "2026-04-08", debit: 50000, credit: 0 }, // Debtors
  { accountId: 7, date: "2026-04-08", debit: 0, credit: 50000 }, // Sales
  { accountId: 1, date: "2026-04-20", debit: 45000, credit: 0 }, // Bank
  { accountId: 2, date: "2026-04-20", debit: 0, credit: 45000 }, // Debtors (collection)
  { accountId: 9, date: "2026-04-10", debit: 20000, credit: 0 }, // Purchases
  { accountId: 3, date: "2026-04-10", debit: 0, credit: 20000 }, // Creditors
  { accountId: 10, date: "2026-04-30", debit: 100, credit: 0 }, // Bank Charges
  { accountId: 1, date: "2026-04-30", debit: 0, credit: 100 }, // Bank

  // May 2026 trading.
  { accountId: 2, date: "2026-05-06", debit: 60000, credit: 0 }, // Debtors
  { accountId: 7, date: "2026-05-06", debit: 0, credit: 60000 }, // Sales
  { accountId: 1, date: "2026-05-22", debit: 55000, credit: 0 }, // Bank
  { accountId: 2, date: "2026-05-22", debit: 0, credit: 55000 }, // Debtors (collection)
  { accountId: 9, date: "2026-05-12", debit: 25000, credit: 0 }, // Purchases
  { accountId: 3, date: "2026-05-12", debit: 0, credit: 25000 }, // Creditors
  { accountId: 10, date: "2026-05-31", debit: 120, credit: 0 }, // Bank Charges
  { accountId: 1, date: "2026-05-31", debit: 0, credit: 120 }, // Bank
  { accountId: 1, date: "2026-05-18", debit: 300, credit: 0 }, // Bank
  { accountId: 11, date: "2026-05-18", debit: 0, credit: 300 }, // Interest Received
];

/** Same technique as `general-ledger-data.ts::buildMockTrialBalance`,
 * with a cumulative-as-of-date cutoff — mirrors `fn_trial_balance`'s own
 * semantics exactly, so `computePeriodMovements`'s two-snapshot-diff
 * technique works identically on this mock data. */
export function trialBalanceRowsAsOf(asOfDate: string): TrialBalanceRow[] {
  const totalsByAccountId = new Map<number, { debit: number; credit: number }>();
  for (const p of POSTINGS) {
    if (p.date > asOfDate) continue;
    const existing = totalsByAccountId.get(p.accountId) ?? { debit: 0, credit: 0 };
    existing.debit += p.debit;
    existing.credit += p.credit;
    totalsByAccountId.set(p.accountId, existing);
  }

  const rpcRows: TrialBalanceRpcRow[] = MOCK_CHART_OF_ACCOUNTS.map((account) => {
    const totals = totalsByAccountId.get(account.id) ?? { debit: 0, credit: 0 };
    return {
      account_id: account.id,
      account_code: account.accountCode,
      description: account.description,
      account_type: account.accountType,
      normal_balance: account.normalBalance,
      total_debit: totals.debit,
      total_credit: totals.credit,
    };
  });

  return rpcRows.map(trialBalanceRowFromRpcRow);
}

export const ACCOUNTS: ChartOfAccount[] = MOCK_CHART_OF_ACCOUNTS;
export const FINANCIAL_YEAR_START = "2026-01-01";
export const PERIOD_START = "2026-05-01";
export const PERIOD_END = "2026-05-31";

export const MOCK_INCOME_STATEMENT: IncomeStatement = buildIncomeStatement(
  ACCOUNTS,
  trialBalanceRowsAsOf("2026-04-30"),
  trialBalanceRowsAsOf(PERIOD_END),
  PERIOD_START,
  PERIOD_END,
);

const MOCK_YTD_INCOME_STATEMENT: IncomeStatement = buildIncomeStatement(
  ACCOUNTS,
  trialBalanceRowsAsOf("2025-12-31"),
  trialBalanceRowsAsOf(PERIOD_END),
  FINANCIAL_YEAR_START,
  PERIOD_END,
);

export const MOCK_BALANCE_SHEET: BalanceSheet = buildBalanceSheet(ACCOUNTS, trialBalanceRowsAsOf(PERIOD_END), PERIOD_END, MOCK_YTD_INCOME_STATEMENT.netProfit);

export const MOCK_CASH_FLOW_STATEMENT: CashFlowStatement = buildCashFlowStatement(
  ACCOUNTS,
  trialBalanceRowsAsOf("2026-04-30"),
  trialBalanceRowsAsOf(PERIOD_END),
  PERIOD_START,
  PERIOD_END,
  MOCK_INCOME_STATEMENT.netProfit,
  [1],
);

// ---------------------------------------------------------------------
// Forecasts — same real `linearRegressionForecast`, fed a small
// hand-authored historical series (a real product would source this
// from monthly Trial Balance snapshots — see `forecast-service.ts`).
// ---------------------------------------------------------------------

const monthLabel = (i: number) => `2026-0${8 + i}`;

export const MOCK_CASHFLOW_FORECAST: ForecastResult = linearRegressionForecast(
  [
    { period: "2026-02", value: 74900 },
    { period: "2026-03", value: 96000 },
    { period: "2026-04", value: 74900 },
    { period: "2026-05", value: 130080 },
  ],
  3,
  monthLabel,
);

export const MOCK_REVENUE_FORECAST: ForecastResult = linearRegressionForecast(
  [
    { period: "2026-02", value: 42000 },
    { period: "2026-03", value: 47000 },
    { period: "2026-04", value: 50000 },
    { period: "2026-05", value: 60000 },
  ],
  3,
  monthLabel,
);

// ---------------------------------------------------------------------
// Executive scores — same real, disclosed formulas
// (`scoring-engine.ts`/`computeComplianceScore`), fed representative
// hand-picked inputs (Preview Mode has no live exception queues to
// count from).
// ---------------------------------------------------------------------

export const MOCK_FINANCIAL_HEALTH_SCORE = computeFinancialHealthScore({
  isBalanceSheetBalanced: MOCK_BALANCE_SHEET.isBalanced,
  assetToLiabilityRatio: MOCK_BALANCE_SHEET.totalAssets / MOCK_BALANCE_SHEET.liabilities.total,
  netProfitMarginPercent: MOCK_INCOME_STATEMENT.netProfit / MOCK_INCOME_STATEMENT.revenue.total,
  cashTrendImproving: true,
});

export const MOCK_BUSINESS_RISK_SCORE = computeBusinessRiskScore({
  openBankingExceptionCount: 2,
  openVatExceptionCount: MOCK_VAT_EXCEPTIONS.filter((e) => e.status === "Open").length,
  highRiskVatTransactionCount: 1,
  overdueDebtorsCount: 1,
  supplierConcentrationRiskCount: 0,
  duplicateTransactionSuspectCount: 1,
});

export const MOCK_AUDIT_READINESS_SCORE = computeAuditReadinessScore({
  stalePostingCount: 1,
  staleDraftCount: 2,
  openBankingExceptionCount: 2,
  openVatExceptionCount: MOCK_VAT_EXCEPTIONS.filter((e) => e.status === "Open").length,
  failedAutomationTaskCount: 0,
});

export const MOCK_COMPLIANCE_SCORE = computeComplianceScore(MOCK_VAT_EXCEPTIONS.filter((e) => e.status === "Open"), 1);

export const MOCK_NORMALIZED_INTELLIGENCE_SIGNALS: NormalizedIntelligenceSignal[] = [
  {
    source: "Financial",
    kind: "possible-duplicate-journal",
    message: "2 journals posted the same debit amount (250) to 6100 on 2026-06-05",
    reasoning: "2 separate journals posted the same debit amount (250) to 6100 on 2026-06-05 — worth checking for a duplicate.",
    confidence: 0.7,
  },
  {
    source: "Financial",
    kind: "unusual-growth",
    message: "6100 — Bank Charges moved up 178% vs. the prior period",
    reasoning: "6100 moved up 178% vs. the prior period (90 -> 250).",
    confidence: 0.75,
  },
];

// ---------------------------------------------------------------------
// Budgets, Report Definitions, Executive Alerts.
// ---------------------------------------------------------------------

export const MOCK_BUDGETS: Budget[] = [
  { id: 1, companyId: COMPANY_ID, accountId: 7, financialYearLabel: "FY2026", branchId: null, departmentId: null, costCentreId: null, projectId: null, amount: 600000, createdBy: "System", createdAt: "2026-01-05T09:00:00Z", updatedAt: "2026-01-05T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, accountId: 9, financialYearLabel: "FY2026", branchId: null, departmentId: null, costCentreId: null, projectId: null, amount: 260000, createdBy: "System", createdAt: "2026-01-05T09:00:00Z", updatedAt: "2026-01-05T09:00:00Z" },
  { id: 3, companyId: COMPANY_ID, accountId: 10, financialYearLabel: "FY2026", branchId: null, departmentId: null, costCentreId: null, projectId: null, amount: 1200, createdBy: "System", createdAt: "2026-01-05T09:00:00Z", updatedAt: "2026-01-05T09:00:00Z" },
];

export const MOCK_REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    name: "Monthly Income Statement — Summary",
    reportType: "IncomeStatement",
    columns: [
      { field: "accountCode", label: "Account" },
      { field: "description", label: "Description" },
      { field: "amount", label: "Amount" },
    ],
    groups: [{ field: "reportingGroup", label: "Reporting Group" }],
    filters: {},
    calculatedFields: [],
    createdBy: "System",
    createdAt: "2026-02-01T09:00:00Z",
    updatedAt: "2026-02-01T09:00:00Z",
  },
];

export const MOCK_EXECUTIVE_ALERTS: ExecutiveAlert[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    alertType: "MarginReduction",
    priority: "High",
    reason: "Gross margin fell 6.2 percentage points vs. the prior period.",
    evidence: "Gross margin 65% -> 58.8%.",
    recommendedAction: "Review cost of sales and pricing for the current period.",
    relatedType: null,
    relatedId: null,
    status: "Open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-06-01T08:00:00Z",
  },
  {
    id: 2,
    companyId: COMPANY_ID,
    alertType: "InventoryProblems",
    priority: "Medium",
    reason: "3 item(s) awaiting reorder.",
    evidence: "Reorder alerts: 3.",
    recommendedAction: "Review the Inventory workspace's reorder list.",
    relatedType: null,
    relatedId: null,
    status: "Open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-06-02T08:00:00Z",
  },
  {
    id: 3,
    companyId: COMPANY_ID,
    alertType: "DuplicateTrends",
    priority: "Medium",
    reason: "A possible duplicate posting group was detected this period.",
    evidence: "2 separate journals posted the same debit amount (250) to 6100 on 2026-06-05.",
    recommendedAction: "Review the Financial Intelligence report's duplicate postings list.",
    relatedType: null,
    relatedId: null,
    status: "Resolved",
    resolvedBy: "System",
    resolvedAt: "2026-06-10T10:00:00Z",
    resolutionNote: "Confirmed a genuine re-entry; the earlier journal was reversed.",
    createdAt: "2026-06-05T08:00:00Z",
  },
];
