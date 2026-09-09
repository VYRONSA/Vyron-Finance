/**
 * Preview Mode seed data for the AI Executive Copilot & Financial
 * Intelligence Platform (Module 12). Every answer/narrative/scenario
 * below is DERIVED by calling the real pure engines
 * (`copilot-assistant-engine.ts`/`narrative-engine.ts`/
 * `scenario-engine.ts`/`executive-briefing-engine.ts`) against the same
 * mock financial statements `financial-reporting-data.ts` already
 * established (April vs May 2026, computed from the same underlying
 * mock ledger) — the same "derived, not hand-typed" discipline every
 * prior module's mock data followed.
 */

import { buildIncomeStatement, type IncomeStatement } from "@/server/reporting/income-statement-engine";
import { buildBalanceSheet } from "@/server/reporting/balance-sheet-engine";
import {
  answerBiggestRisks,
  answerCashFlowMovements,
  answerCashFlowPressure,
  answerInventoryIncrease,
  answerProfitDecrease,
  answerProfitabilityActions,
  answerWhatChanged,
  type CopilotAnswer,
  type RiskItem,
} from "@/server/copilot/copilot-assistant-engine";
import { buildBudgetVarianceExplanation, buildCashFlowCommentary, buildFinancialNarrative, buildProfitabilityCommentary } from "@/server/copilot/narrative-engine";
import { simulateOpexReduction, simulateSalesIncrease, type ScenarioIncomeBaseline } from "@/server/copilot/scenario-engine";
import { buildExecutiveBriefing } from "@/server/copilot/executive-briefing-engine";
import type { CopilotBriefing, CopilotNarrative, CopilotScenario } from "@/server/copilot/types";
import {
  ACCOUNTS,
  MOCK_BALANCE_SHEET,
  MOCK_CASHFLOW_FORECAST,
  MOCK_CASH_FLOW_STATEMENT,
  MOCK_INCOME_STATEMENT,
  MOCK_AUDIT_READINESS_SCORE,
  MOCK_BUSINESS_RISK_SCORE,
  MOCK_COMPLIANCE_SCORE,
  MOCK_FINANCIAL_HEALTH_SCORE,
  MOCK_NORMALIZED_INTELLIGENCE_SIGNALS,
  trialBalanceRowsAsOf,
} from "./financial-reporting-data";
import { MOCK_AUDIT_FINDINGS } from "./audit-data";
import { MOCK_ASSET_FINDINGS } from "./asset-data";
import { computeAssetHealthScore } from "@/server/services/asset-dashboard-summary-service";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

// A real prior period (April 2026), derived the exact same way
// `financial-reporting-data.ts::MOCK_INCOME_STATEMENT` (May 2026) was —
// two Trial Balance snapshots over the same underlying mock ledger.
const MOCK_PRIOR_INCOME_STATEMENT: IncomeStatement = buildIncomeStatement(ACCOUNTS, trialBalanceRowsAsOf("2026-03-31"), trialBalanceRowsAsOf("2026-04-30"), "2026-04-01", "2026-04-30");
const MOCK_PRIOR_BALANCE_SHEET = buildBalanceSheet(ACCOUNTS, trialBalanceRowsAsOf("2026-04-30"), "2026-04-30", MOCK_PRIOR_INCOME_STATEMENT.netProfit);

export const MOCK_COPILOT_ANSWERS: CopilotAnswer[] = [
  answerProfitDecrease(MOCK_INCOME_STATEMENT, MOCK_PRIOR_INCOME_STATEMENT),
  answerCashFlowMovements(MOCK_CASH_FLOW_STATEMENT),
  answerWhatChanged(MOCK_INCOME_STATEMENT, MOCK_PRIOR_INCOME_STATEMENT, MOCK_BALANCE_SHEET, MOCK_PRIOR_BALANCE_SHEET),
  answerCashFlowPressure(MOCK_CASHFLOW_FORECAST),
  answerProfitabilityActions(MOCK_INCOME_STATEMENT),
  answerInventoryIncrease(0, 0, MOCK_CASHFLOW_FORECAST.confidence),
  answerBiggestRisks([
    ...MOCK_NORMALIZED_INTELLIGENCE_SIGNALS.map((s): RiskItem => ({ label: s.message, confidence: s.confidence, source: s.source })),
    ...MOCK_AUDIT_FINDINGS.filter((f) => f.status === "Open").map((f): RiskItem => ({ label: f.reason, confidence: f.confidence, source: "Audit" })),
    ...MOCK_ASSET_FINDINGS.filter((f) => f.status === "Open").map((f): RiskItem => ({ label: f.reason, confidence: f.confidence, source: "Assets" })),
  ]),
];

export const MOCK_COPILOT_NARRATIVES: CopilotNarrative[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    narrativeType: "MonthEnd",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    title: "Month-End Summary — 2026-05-01 to 2026-05-31",
    content: buildFinancialNarrative("Month-End Summary — 2026-05-01 to 2026-05-31", MOCK_INCOME_STATEMENT, MOCK_PRIOR_INCOME_STATEMENT, MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT),
    generatedAt: "2026-06-01T08:00:00Z",
    generatedBy: "System",
  },
  {
    id: 2,
    companyId: COMPANY_ID,
    narrativeType: "CashFlowCommentary",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    title: "Cash Flow Commentary — 2026-05-01 to 2026-05-31",
    content: buildCashFlowCommentary(MOCK_CASH_FLOW_STATEMENT),
    generatedAt: "2026-06-01T08:05:00Z",
    generatedBy: "System",
  },
  {
    id: 3,
    companyId: COMPANY_ID,
    narrativeType: "ProfitabilityCommentary",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    title: "Profitability Commentary — 2026-05-01 to 2026-05-31",
    content: buildProfitabilityCommentary(MOCK_INCOME_STATEMENT, MOCK_PRIOR_INCOME_STATEMENT),
    generatedAt: "2026-06-01T08:10:00Z",
    generatedBy: "System",
  },
  {
    id: 4,
    companyId: COMPANY_ID,
    narrativeType: "BudgetVarianceExplanation",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    title: "Budget Variance Explanation — FY2026",
    content: buildBudgetVarianceExplanation([{ accountCode: "4000", description: "Sales", budget: 600000, actual: MOCK_INCOME_STATEMENT.revenue.total, variance: Math.round((MOCK_INCOME_STATEMENT.revenue.total - 600000) * 100) / 100, variancePercent: Math.round(((MOCK_INCOME_STATEMENT.revenue.total - 600000) / 600000) * 1000) / 10 }]),
    generatedAt: "2026-06-01T08:15:00Z",
    generatedBy: "System",
  },
];

const scenarioBaseline: ScenarioIncomeBaseline = {
  revenue: MOCK_INCOME_STATEMENT.revenue.total,
  costOfSales: MOCK_INCOME_STATEMENT.costOfSales.total,
  operatingExpenses: MOCK_INCOME_STATEMENT.operatingExpenses.total,
  otherIncome: MOCK_INCOME_STATEMENT.otherIncome.total,
  otherExpense: MOCK_INCOME_STATEMENT.otherExpense.total,
  netProfit: MOCK_INCOME_STATEMENT.netProfit,
};

export const MOCK_COPILOT_SCENARIOS: CopilotScenario[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    name: "10% Sales Increase",
    scenarioType: "SalesIncrease",
    parameters: { percent: 10 },
    results: simulateSalesIncrease(scenarioBaseline, 10),
    createdBy: "System",
    createdAt: "2026-06-01T09:00:00Z",
  },
  {
    id: 2,
    companyId: COMPANY_ID,
    name: "10% Operating Expense Reduction",
    scenarioType: "OpexReduction",
    parameters: { percent: 10 },
    results: simulateOpexReduction(scenarioBaseline, 10),
    createdBy: "System",
    createdAt: "2026-06-01T09:05:00Z",
  },
];

const briefingContent = buildExecutiveBriefing({
  financialHealthScore: MOCK_FINANCIAL_HEALTH_SCORE,
  businessRiskScore: MOCK_BUSINESS_RISK_SCORE,
  auditReadinessScore: MOCK_AUDIT_READINESS_SCORE,
  complianceScorePercent: MOCK_COMPLIANCE_SCORE,
  assetHealthScore: computeAssetHealthScore(MOCK_ASSET_FINDINGS.filter((f) => f.status === "Open")),
  cashPosition: MOCK_CASH_FLOW_STATEMENT.closingCash,
  cashTrendImproving: MOCK_CASHFLOW_FORECAST.forecast.length > 0 && MOCK_CASHFLOW_FORECAST.forecast[MOCK_CASHFLOW_FORECAST.forecast.length - 1].value >= MOCK_CASHFLOW_FORECAST.forecast[0].value,
  signals: [
    ...MOCK_NORMALIZED_INTELLIGENCE_SIGNALS.map((s) => ({ label: s.message, confidence: s.confidence, source: s.source })),
    ...MOCK_AUDIT_FINDINGS.filter((f) => f.status === "Open").map((f) => ({ label: f.reason, confidence: f.confidence, source: "Audit" })),
    ...MOCK_ASSET_FINDINGS.filter((f) => f.status === "Open").map((f) => ({ label: f.reason, confidence: f.confidence, source: "Assets" })),
  ],
});

export const MOCK_COPILOT_BRIEFING: CopilotBriefing = {
  id: 1,
  companyId: COMPANY_ID,
  briefingDate: "2026-06-01",
  content: briefingContent,
  generatedAt: "2026-06-01T06:00:00Z",
  generatedBy: "System",
};
