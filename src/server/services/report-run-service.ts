/**
 * Master Implementation Tracker — Epic E9, Finding #045. A saved
 * `ReportDefinition` could be created and deleted, but never actually
 * run — `evaluateCalculatedFields` (`report-definition-service.ts`) was
 * called nowhere outside its own definition. Each `ReportType` maps 1:1
 * onto an already-built engine/service; this file is only the dispatch
 * + projection layer, not a second reporting engine — every raw row
 * below is produced by the exact same function the report's own
 * dedicated page already calls (Trial Balance, Income Statement, Balance
 * Sheet, Cash Flow, GL Inquiry, Budget vs Actual).
 */

import { getTrialBalance } from "@/server/services/trial-balance-service";
import { getBalanceSheet, getCashFlowStatement, getIncomeStatement } from "@/server/services/financial-statements-service";
import { listGlTransactions } from "@/server/services/gl-inquiry-service";
import { listBudgets } from "@/server/services/budget-service";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { evaluateCalculatedFields } from "@/server/services/report-definition-service";
import type { StatementSection } from "@/server/reporting/income-statement-engine";
import type { ReportDefinition } from "@/server/reporting/types";

export class ValidationError extends Error {}

export type RunReportParams = {
  asOfDate?: string;
  periodStart?: string;
  periodEnd?: string;
  financialYearStartDate?: string;
  financialYearLabel?: string;
};

function requireDate(value: string | undefined, label: string): string {
  if (!value) throw new ValidationError(`${label} is required to run this report.`);
  return value;
}

function flattenSections(sections: StatementSection[]): Record<string, unknown>[] {
  return sections.flatMap((s) => s.lines.map((l) => ({ accountCode: l.accountCode, description: l.description, reportingGroup: l.reportingGroup, amount: l.amount })));
}

// GL Inquiry is keyset-paginated for a reason (see `gl-inquiry-service.ts`'s
// own docstring — no OFFSET pagination at this scale); a Report Designer
// "Run" walks pages up to this cap rather than looping unbounded, the
// same LIST_CAP-style ceiling every other bulk read in this codebase uses.
const GL_INQUIRY_MAX_ROWS = 10_000;
const GL_INQUIRY_PAGE_SIZE = 500;

async function getRawRows(companyId: string, definition: ReportDefinition, params: RunReportParams): Promise<Record<string, unknown>[]> {
  switch (definition.reportType) {
    case "TrialBalance":
    case "Custom": {
      const tb = await getTrialBalance(companyId, params.asOfDate ?? null);
      return tb.rows.map((r) => ({
        accountCode: r.accountCode,
        description: r.description,
        debitBalance: r.debitBalance,
        creditBalance: r.creditBalance,
        // "Custom" has no dedicated engine yet (see REPORT_TYPES) — its
        // column set (accountCode/description/amount) is closest to Trial
        // Balance, so it reuses the same rows with one net `amount`
        // derived the same way every statement engine signs a balance.
        amount: r.debitBalance - r.creditBalance,
      }));
    }
    case "IncomeStatement": {
      const periodStart = requireDate(params.periodStart, "Period Start");
      const periodEnd = requireDate(params.periodEnd, "Period End");
      const statement = await getIncomeStatement(companyId, periodStart, periodEnd);
      return flattenSections([statement.revenue, statement.costOfSales, statement.operatingExpenses, statement.otherIncome, statement.otherExpense]);
    }
    case "BalanceSheet": {
      const asOfDate = requireDate(params.asOfDate, "As At date");
      const financialYearStartDate = requireDate(params.financialYearStartDate, "Financial Year Start");
      const sheet = await getBalanceSheet(companyId, asOfDate, financialYearStartDate);
      return flattenSections([sheet.assets, sheet.liabilities, sheet.equity]);
    }
    case "CashFlow": {
      const periodStart = requireDate(params.periodStart, "Period Start");
      const periodEnd = requireDate(params.periodEnd, "Period End");
      const cf = await getCashFlowStatement(companyId, periodStart, periodEnd);
      return [cf.operatingActivities, cf.investingActivities, cf.financingActivities].flatMap((s) => s.lines.map((l) => ({ description: l.description, amount: l.amount })));
    }
    case "GLInquiry": {
      const dateFrom = requireDate(params.periodStart, "Period Start");
      const dateTo = requireDate(params.periodEnd, "Period End");
      const filters = { dateFrom, dateTo, accountId: null, reference: null, search: null, branchId: null, departmentId: null, costCentreId: null, sourceType: null };
      const rows: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      while (rows.length < GL_INQUIRY_MAX_ROWS) {
        const page = await listGlTransactions(companyId, filters, cursor, GL_INQUIRY_PAGE_SIZE);
        rows.push(...page.transactions.map((t) => ({ postingDate: t.postingDate, accountCode: t.accountCode, reference: t.reference, debit: t.debit, credit: t.credit })));
        if (!page.hasMore || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return rows;
    }
    case "BudgetVsActual": {
      const financialYearLabel = params.financialYearLabel?.trim();
      if (!financialYearLabel) throw new ValidationError("Financial Year is required to run this report.");
      const periodStart = requireDate(params.periodStart, "Period Start");
      const periodEnd = requireDate(params.periodEnd, "Period End");

      const [budgets, accounts, statement] = await Promise.all([
        listBudgets(companyId, financialYearLabel),
        listChartOfAccounts(companyId),
        getIncomeStatement(companyId, periodStart, periodEnd),
      ]);
      const actualByAccountId = new Map(
        [statement.revenue, statement.costOfSales, statement.operatingExpenses, statement.otherIncome, statement.otherExpense]
          .flatMap((s) => s.lines)
          .map((l) => [l.accountId, l.amount]),
      );
      return budgets.map((b) => {
        const account = accounts.find((a) => a.id === b.accountId);
        const actual = actualByAccountId.get(b.accountId) ?? 0;
        return { accountCode: account?.accountCode ?? String(b.accountId), budget: b.amount, actual, variance: Math.round((actual - b.amount) * 100) / 100 };
      });
    }
  }
}

export type RunReportResult = { rows: Record<string, unknown>[] };

export async function runReportDefinition(companyId: string, definition: ReportDefinition, params: RunReportParams): Promise<RunReportResult> {
  const rawRows = await getRawRows(companyId, definition, params);
  const rows = rawRows.map((row) => {
    const withCalculated = evaluateCalculatedFields(row, definition.calculatedFields);
    const projected: Record<string, unknown> = {};
    for (const col of definition.columns) projected[col.field] = withCalculated[col.field];
    for (const field of definition.calculatedFields) projected[field.name] = withCalculated[field.name];
    return projected;
  });
  return { rows };
}
