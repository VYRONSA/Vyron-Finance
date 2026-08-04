/**
 * Application Service for Financial Statements — the ONE place Income
 * Statement/Balance Sheet/Cash Flow are assembled from live data. Every
 * figure comes from the existing `getTrialBalance` (called twice per
 * period, snapshot-diffed) and `listChartOfAccounts` — no second GL
 * query path, no duplicated calculation, per the platform's standing
 * "generated from live accounting data" rule.
 */

import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { buildIncomeStatement, type IncomeStatement } from "@/server/reporting/income-statement-engine";
import { buildBalanceSheet, type BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import { buildCashFlowStatement, type CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import { buildStatementOfChangesInEquity, type StatementOfChangesInEquity } from "@/server/reporting/equity-engine";
import type { ChartOfAccount } from "@/server/general-ledger/types";

/** Pure — one day before an ISO date, for the "as-of the day before
 * periodStart" snapshot the two-Trial-Balance-diff technique needs. */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Pure — identifies cash/bank accounts for the Cash Flow Statement by
 * name, since Chart of Accounts has no dedicated "is cash equivalent"
 * flag (disclosed limitation — see `cash-flow-engine.ts`'s docstring for
 * why the engine itself takes this as an explicit parameter rather than
 * guessing internally). Matches the same "Bank" naming convention
 * `seed_company_defaults()` seeds every company's default chart with. */
export function identifyCashAccountIds(accounts: ChartOfAccount[]): number[] {
  return accounts.filter((a) => a.accountType === "Asset" && /bank|cash/i.test(a.description)).map((a) => a.id);
}

export async function getIncomeStatement(companyId: string, periodStart: string, periodEnd: string): Promise<IncomeStatement> {
  const accounts = await listChartOfAccounts(companyId);
  const [startBalance, endBalance] = await Promise.all([getTrialBalance(companyId, dayBefore(periodStart)), getTrialBalance(companyId, periodEnd)]);
  return buildIncomeStatement(accounts, startBalance.rows, endBalance.rows, periodStart, periodEnd);
}

export async function getBalanceSheet(companyId: string, asOfDate: string, financialYearStartDate: string): Promise<BalanceSheet> {
  const accounts = await listChartOfAccounts(companyId);
  const [asOfBalance, incomeStatement] = await Promise.all([getTrialBalance(companyId, asOfDate), getIncomeStatement(companyId, financialYearStartDate, asOfDate)]);
  return buildBalanceSheet(accounts, asOfBalance.rows, asOfDate, incomeStatement.netProfit);
}

export async function getCashFlowStatement(companyId: string, periodStart: string, periodEnd: string): Promise<CashFlowStatement> {
  const accounts = await listChartOfAccounts(companyId);
  const [startBalance, endBalance] = await Promise.all([getTrialBalance(companyId, dayBefore(periodStart)), getTrialBalance(companyId, periodEnd)]);
  const incomeStatement = buildIncomeStatement(accounts, startBalance.rows, endBalance.rows, periodStart, periodEnd);
  const cashAccountIds = identifyCashAccountIds(accounts);
  return buildCashFlowStatement(accounts, startBalance.rows, endBalance.rows, periodStart, periodEnd, incomeStatement.netProfit, cashAccountIds);
}

/** The 4th primary statement — Statement of Changes in Equity. Reuses the
 * SAME two-Trial-Balance-snapshot technique as every statement above,
 * and — like `getBalanceSheet` — folds in year-to-date Net Profit (from
 * `financialYearStartDate`, not from `periodStart`), so its
 * `totalClosingBalance` always ties to `getBalanceSheet`'s `equity.total`
 * for the same `periodEnd`. Call with `periodStart = financialYearStartDate`
 * for the standard, GAAP-compliant annual reconciliation — that's the
 * only way `openingBalance` (a real Trial Balance snapshot, no synthetic
 * earnings in it) and the synthetic "Profit for the Period" row (which
 * always carries the FULL year-to-date figure) describe the same window
 * without double-counting or omitting any prior sub-period's earnings. */
export async function getStatementOfChangesInEquity(companyId: string, periodStart: string, periodEnd: string, financialYearStartDate: string): Promise<StatementOfChangesInEquity> {
  const accounts = await listChartOfAccounts(companyId);
  const [openingBalance, closingBalance, incomeStatement] = await Promise.all([
    getTrialBalance(companyId, dayBefore(periodStart)),
    getTrialBalance(companyId, periodEnd),
    getIncomeStatement(companyId, financialYearStartDate, periodEnd),
  ]);
  return buildStatementOfChangesInEquity(accounts, openingBalance.rows, closingBalance.rows, periodStart, periodEnd, incomeStatement.netProfit);
}
