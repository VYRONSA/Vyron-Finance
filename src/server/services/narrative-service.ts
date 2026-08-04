/**
 * Application Service for the Financial Narrative Engine — fetches real
 * data from `financial-statements-service.ts`/`budget-service.ts` and
 * hands it to the pure builders in `narrative-engine.ts`, then persists
 * the result. "One Pure Calculation Library": every period-summary type
 * (Month-End/Quarter-End/Year-End/Board Pack/Management Report) calls
 * the SAME `buildFinancialNarrative`, differing only in title/period.
 */

import { getIncomeStatement, getBalanceSheet, getCashFlowStatement } from "@/server/services/financial-statements-service";
import { shiftPeriodBack } from "@/server/general-ledger/growth-analysis";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { listBudgets } from "@/server/services/budget-service";
import { buildBudgetVarianceExplanation, buildCashFlowCommentary, buildFinancialNarrative, buildProfitabilityCommentary, type BudgetVarianceRow } from "@/server/copilot/narrative-engine";
import * as repo from "@/server/repositories/copilot-narrative-repository";
import type { CopilotNarrative, NarrativeType } from "@/server/copilot/types";

export const listCopilotNarratives = repo.listCopilotNarratives;

const TITLE_BY_TYPE: Record<"MonthEnd" | "QuarterEnd" | "YearEnd" | "BoardPack" | "ManagementReport", string> = {
  MonthEnd: "Month-End Summary",
  QuarterEnd: "Quarter-End Summary",
  YearEnd: "Year-End Summary",
  BoardPack: "Board Pack Summary",
  ManagementReport: "Management Report",
};

export async function generateNarrative(
  companyId: string,
  narrativeType: NarrativeType,
  periodStart: string,
  periodEnd: string,
  financialYearStartDate: string,
  financialYearLabel: string,
  generatedBy: string,
): Promise<CopilotNarrative> {
  let title: string;
  let content: { title: string; facts: string[]; interpretations: string[] };

  if (narrativeType in TITLE_BY_TYPE) {
    const previous = shiftPeriodBack(periodStart, periodEnd);
    const [current, prior, balanceSheet, cashFlow] = await Promise.all([
      getIncomeStatement(companyId, periodStart, periodEnd),
      getIncomeStatement(companyId, previous.dateFrom, previous.dateTo),
      getBalanceSheet(companyId, periodEnd, financialYearStartDate),
      getCashFlowStatement(companyId, periodStart, periodEnd),
    ]);
    title = `${TITLE_BY_TYPE[narrativeType as keyof typeof TITLE_BY_TYPE]} — ${periodStart} to ${periodEnd}`;
    content = buildFinancialNarrative(title, current, prior, balanceSheet, cashFlow);
  } else if (narrativeType === "CashFlowCommentary") {
    const cashFlow = await getCashFlowStatement(companyId, periodStart, periodEnd);
    title = `Cash Flow Commentary — ${periodStart} to ${periodEnd}`;
    content = { ...buildCashFlowCommentary(cashFlow), title };
  } else if (narrativeType === "BudgetVarianceExplanation") {
    const [budgets, accounts, incomeStatement] = await Promise.all([listBudgets(companyId, financialYearLabel), listChartOfAccounts(companyId), getIncomeStatement(companyId, periodStart, periodEnd)]);
    const actualByAccountId = new Map([...incomeStatement.revenue.lines, ...incomeStatement.costOfSales.lines, ...incomeStatement.operatingExpenses.lines].map((l) => [l.accountId, l.amount]));
    const rows: BudgetVarianceRow[] = budgets.map((b) => {
      const account = accounts.find((a) => a.id === b.accountId);
      const actual = actualByAccountId.get(b.accountId) ?? 0;
      const variance = Math.round((actual - b.amount) * 100) / 100;
      const variancePercent = b.amount !== 0 ? Math.round((variance / Math.abs(b.amount)) * 1000) / 10 : null;
      return { accountCode: account?.accountCode ?? String(b.accountId), description: account?.description ?? "", budget: b.amount, actual, variance, variancePercent };
    });
    title = `Budget Variance Explanation — ${financialYearLabel}`;
    content = { ...buildBudgetVarianceExplanation(rows), title };
  } else {
    const previous = shiftPeriodBack(periodStart, periodEnd);
    const [current, prior] = await Promise.all([getIncomeStatement(companyId, periodStart, periodEnd), getIncomeStatement(companyId, previous.dateFrom, previous.dateTo)]);
    title = `Profitability Commentary — ${periodStart} to ${periodEnd}`;
    content = { ...buildProfitabilityCommentary(current, prior), title };
  }

  return repo.createCopilotNarrative(companyId, { narrativeType, periodStart, periodEnd, title, content, generatedBy });
}
