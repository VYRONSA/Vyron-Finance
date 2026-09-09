/**
 * The Financial Narrative Engine — pure, no Supabase. "One Pure
 * Calculation Library": `buildFinancialNarrative` is the ONE function
 * behind Month-End, Quarter-End, Year-End, Board Pack, and Management
 * Report narratives (the Product Review Board's own 5 period-summary
 * types) — they differ only in title/period framing, supplied by the
 * caller, never in calculation. Cash-Flow Commentary, Budget Variance
 * Explanation, and Profitability Commentary are genuinely different
 * shapes of input and get their own builders, but every number in every
 * narrative comes from an Income Statement/Balance Sheet/Cash Flow
 * Statement/Budget row the caller already fetched from
 * `financial-statements-service.ts`/`budget-service.ts` — nothing here
 * recomputes a figure.
 *
 * "Narratives must be based on real calculations and clearly
 * distinguish facts from interpretations" — every narrative separates
 * `facts` (a plain restatement of a real number) from `interpretations`
 * (an explicitly-labeled inference), never blending the two into one
 * unverifiable sentence.
 */

import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";

export type Narrative = { title: string; facts: string[]; interpretations: string[] };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return round2(((current - prior) / Math.abs(prior)) * 100);
}

/** The one generic period-summary narrative — Month-End/Quarter-End/
 * Year-End/Board Pack/Management Report all call this with the same
 * real Income Statement + Balance Sheet + Cash Flow data, differing
 * only in `title`. */
export function buildFinancialNarrative(title: string, current: IncomeStatement, prior: IncomeStatement, balanceSheet: BalanceSheet, cashFlow: CashFlowStatement): Narrative {
  const revenueChange = percentChange(current.revenue.total, prior.revenue.total);
  const profitChange = percentChange(current.netProfit, prior.netProfit);

  const facts = [
    `Revenue for ${current.periodStart} to ${current.periodEnd}: ${current.revenue.total} (prior period: ${prior.revenue.total}).`,
    `Gross Profit: ${current.grossProfit}. Operating Profit: ${current.operatingProfit}. Net Profit: ${current.netProfit}.`,
    `Total Assets as of ${balanceSheet.asOfDate}: ${balanceSheet.totalAssets}, Total Liabilities and Equity: ${balanceSheet.totalLiabilitiesAndEquity} (${balanceSheet.isBalanced ? "balanced" : "NOT balanced — see Audit Findings"}).`,
    `Cash moved from ${cashFlow.openingCash} to ${cashFlow.closingCash} this period (net change: ${cashFlow.netChangeInCash}).`,
  ];

  const interpretations: string[] = [];
  if (revenueChange !== null) interpretations.push(`Revenue ${revenueChange >= 0 ? "grew" : "declined"} ${Math.abs(revenueChange)}% period-over-period.`);
  if (profitChange !== null) interpretations.push(`Net Profit ${profitChange >= 0 ? "grew" : "declined"} ${Math.abs(profitChange)}% period-over-period.`);
  if (!balanceSheet.isBalanced) interpretations.push("The Balance Sheet does not currently balance — this is a data-integrity issue that should be investigated before this narrative is relied upon.");
  if (cashFlow.reconciliationVariance !== 0) interpretations.push(`The Cash Flow Statement's reconciliation variance is ${cashFlow.reconciliationVariance}, not zero — investigate before relying on the cash movement figures.`);

  return { title, facts, interpretations };
}

export function buildCashFlowCommentary(cashFlow: CashFlowStatement): Narrative {
  const facts = [
    `Operating Activities: ${cashFlow.operatingActivities.total}.`,
    `Investing Activities: ${cashFlow.investingActivities.total}.`,
    `Financing Activities: ${cashFlow.financingActivities.total}.`,
    `Net change in cash: ${cashFlow.netChangeInCash} (opening ${cashFlow.openingCash}, closing ${cashFlow.closingCash}).`,
  ];
  const interpretations: string[] = [];
  if (cashFlow.operatingActivities.total < 0) interpretations.push("Operating activities consumed cash this period rather than generating it — worth investigating if this persists.");
  if (cashFlow.investingActivities.total === 0) interpretations.push("No investing activity was recorded this period (no Fixed Assets module activity captured here yet).");
  return { title: "Cash Flow Commentary", facts, interpretations };
}

export type BudgetVarianceRow = { accountCode: string; description: string; budget: number; actual: number; variance: number; variancePercent: number | null };

export function buildBudgetVarianceExplanation(rows: BudgetVarianceRow[]): Narrative {
  if (rows.length === 0) {
    return { title: "Budget Variance Explanation", facts: ["No budgets are set for this financial year."], interpretations: [] };
  }
  const facts = rows.map((r) => `${r.accountCode} — ${r.description}: budget ${r.budget}, actual ${r.actual}, variance ${r.variance}${r.variancePercent !== null ? ` (${r.variancePercent}%)` : ""}.`);
  const materialVariances = rows.filter((r) => r.variancePercent !== null && Math.abs(r.variancePercent) >= 15);
  const interpretations = materialVariances.map((r) => `${r.accountCode} — ${r.description} is ${Math.abs(r.variancePercent!)}% ${r.variance >= 0 ? "over" : "under"} budget — a material variance worth investigating.`);
  return { title: "Budget Variance Explanation", facts, interpretations };
}

export function buildProfitabilityCommentary(current: IncomeStatement, prior: IncomeStatement): Narrative {
  const currentMargin = current.revenue.total !== 0 ? round2((current.grossProfit / current.revenue.total) * 100) : null;
  const priorMargin = prior.revenue.total !== 0 ? round2((prior.grossProfit / prior.revenue.total) * 100) : null;

  const facts = [
    `Gross Profit: ${current.grossProfit} (${currentMargin !== null ? `${currentMargin}% margin` : "margin not meaningful — zero revenue"}).`,
    `Operating Profit: ${current.operatingProfit}. Net Profit: ${current.netProfit}.`,
    `Prior period Gross Margin: ${priorMargin !== null ? `${priorMargin}%` : "not meaningful"}.`,
  ];
  const interpretations: string[] = [];
  if (currentMargin !== null && priorMargin !== null) {
    const marginDelta = round2(currentMargin - priorMargin);
    interpretations.push(`Gross margin ${marginDelta >= 0 ? "improved" : "declined"} by ${Math.abs(marginDelta)} percentage points period-over-period.`);
  }
  if (currentMargin !== null && currentMargin < 30) interpretations.push("Gross margin below 30% may warrant a review of pricing or cost of sales, depending on the industry norm.");
  return { title: "Profitability Commentary", facts, interpretations };
}
