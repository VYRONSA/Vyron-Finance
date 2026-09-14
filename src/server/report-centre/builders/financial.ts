/**
 * Financial statements — Statement of Financial Position, the Profit &
 * Loss family, Budget vs Actual and the Cash Flow Statement.
 *
 * Every figure comes from the platform's existing statement engines
 * (`income-statement-engine.ts`, `balance-sheet-engine.ts`,
 * `cash-flow-engine.ts`) over Trial Balance snapshots — the SAME
 * functions the Financial Statements page uses, so the Reporting Centre
 * can never disagree with it. What this module adds is presentation,
 * comparatives, drill-down and an independent reconciliation of the
 * Profit & Loss to the posted GL lines.
 */

import { buildIncomeStatement, type IncomeStatement, type StatementSection } from "@/server/reporting/income-statement-engine";
import { buildBalanceSheet } from "@/server/reporting/balance-sheet-engine";
import { buildCashFlowStatement } from "@/server/reporting/cash-flow-engine";
import { identifyCashAccountIds } from "@/server/services/financial-statements-service";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import {
  asAtLabel,
  col,
  dayBefore,
  drill,
  F,
  formatDate,
  groupRow,
  monthEnd,
  monthLabel,
  monthsBetween,
  periodLabel,
  row,
  section,
  shiftYears,
  subtotalRow,
  summaryMoney,
  summaryText,
  totalRow,
  type ReportContext,
  type ReportDefinition,
} from "../kit";
import { check, round2, sum, type ReportCell, type ReportColumn, type ReportRow } from "../types";
import { accountsById, financialYearFor, PROFIT_AND_LOSS_TYPES } from "./shared";

export async function incomeStatementFor(ctx: ReportContext, from: string, to: string): Promise<IncomeStatement> {
  const [accounts, start, end] = await Promise.all([ctx.source.accounts(), ctx.source.trialBalance(dayBefore(from)), ctx.source.trialBalance(to)]);
  return buildIncomeStatement(accounts, start, end, from, to);
}

type Period = { key: string; label: string; from: string; to: string; statement: IncomeStatement };

const SECTIONS: { key: "revenue" | "costOfSales" | "operatingExpenses" | "otherIncome" | "otherExpense"; after?: { label: string; value: (s: IncomeStatement) => number } }[] = [
  { key: "revenue" },
  { key: "costOfSales", after: { label: "Gross Profit", value: (s) => s.grossProfit } },
  { key: "operatingExpenses", after: { label: "Operating Profit", value: (s) => s.operatingProfit } },
  { key: "otherIncome" },
  { key: "otherExpense" },
];

/** Profit & Loss rows for one or more periods side by side. `detailed`
 * lists every account; otherwise accounts are grouped by their Chart of
 * Accounts category. Each period gets a column keyed by `period.key`. */
function profitAndLossRows(periods: Period[], accounts: ChartOfAccount[], detailed: boolean, extra?: (values: number[]) => Record<string, ReportCell>): ReportRow[] {
  const byId = accountsById(accounts);
  const rows: ReportRow[] = [];
  const cells = (values: number[]) => ({ ...Object.fromEntries(periods.map((p, i) => [p.key, values[i]])), ...(extra ? extra(values) : {}) });
  const last = periods[periods.length - 1];

  for (const { key, after } of SECTIONS) {
    const sectionsPerPeriod: StatementSection[] = periods.map((p) => p.statement[key]);
    const label = sectionsPerPeriod[0].label;
    const lineIds = [...new Set(sectionsPerPeriod.flatMap((s) => s.lines.map((l) => l.accountId)))];
    if (lineIds.length > 0) {
      rows.push(groupRow({ label }));
      if (detailed) {
        const ordered = lineIds.map((id) => byId.get(id)).filter((a): a is ChartOfAccount => Boolean(a)).sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
        for (const account of ordered) {
          const values = sectionsPerPeriod.map((s) => s.lines.find((l) => l.accountId === account.id)?.amount ?? 0);
          rows.push(row({ label: `${account.accountCode} ${account.description}`, ...cells(values) }, { level: 1, drill: drill.report("gl-account-activity", { accountId: String(account.id), dateFrom: periods[0].from, dateTo: last.to }) }));
        }
      } else {
        const groups = new Map<string, number[]>();
        for (const id of lineIds) {
          const account = byId.get(id);
          const group = account?.category || account?.reportingGroup || account?.description || "Other";
          const values = groups.get(group) ?? periods.map(() => 0);
          sectionsPerPeriod.forEach((s, i) => {
            values[i] = round2(values[i] + (s.lines.find((l) => l.accountId === id)?.amount ?? 0));
          });
          groups.set(group, values);
        }
        for (const [group, values] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          rows.push(row({ label: group, ...cells(values) }, { level: 1, drill: drill.report("detailed-profit-and-loss", { dateFrom: periods[0].from, dateTo: last.to }) }));
        }
      }
      rows.push(subtotalRow({ label: `Total ${label}`, ...cells(sectionsPerPeriod.map((s) => s.total)) }));
    }
    if (after) rows.push(subtotalRow({ label: after.label, ...cells(periods.map((p) => after.value(p.statement))) }));
  }
  rows.push(totalRow({ label: "Net Profit", ...cells(periods.map((p) => p.statement.netProfit)) }));
  return rows;
}

/** Net profit recomputed directly from the posted GL lines — an
 * independent path from the Trial Balance snapshot diff the statement
 * engine uses. The two must agree. */
async function netProfitFromGl(ctx: ReportContext, from: string, to: string): Promise<{ value: number; truncated: boolean }> {
  const [accounts, gl] = await Promise.all([ctx.source.accounts(), ctx.source.glTransactions({ from, to })]);
  const byId = accountsById(accounts);
  let value = 0;
  for (const t of gl.items) {
    const account = byId.get(t.accountId);
    if (account && account.isActive && PROFIT_AND_LOSS_TYPES.includes(account.accountType)) value += t.credit - t.debit;
  }
  return { value: round2(value), truncated: gl.truncated };
}

function grossMarginPercent(s: IncomeStatement): number | null {
  return s.revenue.total !== 0 ? round2((s.grossProfit / s.revenue.total) * 100) : null;
}

function plSummary(s: IncomeStatement) {
  const margin = grossMarginPercent(s);
  return [
    summaryMoney("Revenue", s.revenue.total),
    summaryMoney("Gross Profit", s.grossProfit),
    { label: "Gross Margin", value: margin ?? "—", kind: margin === null ? ("text" as const) : ("percent" as const) },
    summaryMoney("Operating Expenses", s.operatingExpenses.total),
    summaryMoney("Net Profit", s.netProfit),
  ];
}

function profitAndLoss(id: string, title: string, description: string, detailed: boolean): ReportDefinition {
  return {
    id,
    title,
    description,
    categories: ["financial"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [statement, accounts, gl] = await Promise.all([incomeStatementFor(ctx, dateFrom, dateTo), ctx.source.accounts(), netProfitFromGl(ctx, dateFrom, dateTo)]);
      const rows = profitAndLossRows([{ key: "amount", label: "Amount", from: dateFrom, to: dateTo, statement }], accounts, detailed);
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: plSummary(statement),
        sections: [section([col("label", ""), col("amount", periodLabel(dateFrom, dateTo), "money")], rows, undefined, "No income or expense in this period.")],
        checks: [check("Net profit agrees with the posted GL lines", gl.value, statement.netProfit, "The statement is built from Trial Balance snapshots; this recomputes it from every posted GL line in the period.")],
        notices: gl.truncated ? ["The GL exceeded the report read limit, so the GL cross-check covers only part of the period."] : [],
      };
    },
  };
}

export const FINANCIAL_REPORTS: ReportDefinition[] = [
  {
    id: "balance-sheet",
    title: "Statement of Financial Position",
    description: "Assets, liabilities and equity as at a date, with the prior-year comparative — the Balance Sheet.",
    categories: ["financial"],
    filters: [F.asAt, { key: "compareDateTo", label: "Compare as at", control: "date" }],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const compareAt = ctx.filters.compareDateTo || shiftYears(asAt, -1);
      const accounts = await ctx.source.accounts();
      const sheetAt = async (date: string) => {
        const fy = await financialYearFor(ctx, date);
        const [tb, ytd] = await Promise.all([ctx.source.trialBalance(date), incomeStatementFor(ctx, fy.start, date)]);
        return { fy, sheet: buildBalanceSheet(accounts, tb, date, ytd.netProfit), tb };
      };
      const [current, prior] = await Promise.all([sheetAt(asAt), sheetAt(compareAt)]);
      const rows: ReportRow[] = [];
      const sectionRows = (key: "assets" | "liabilities" | "equity") => {
        const c = current.sheet[key];
        const p = prior.sheet[key];
        rows.push(groupRow({ label: c.label }));
        const ids = [...new Set([...c.lines.map((l) => l.accountId), ...p.lines.map((l) => l.accountId)])];
        for (const id of ids) {
          const line = c.lines.find((l) => l.accountId === id) ?? p.lines.find((l) => l.accountId === id)!;
          const label = id === -1 ? line.description : `${line.accountCode} ${line.description}`;
          rows.push(
            row(
              { label, current: c.lines.find((l) => l.accountId === id)?.amount ?? 0, prior: p.lines.find((l) => l.accountId === id)?.amount ?? 0 },
              {
                level: 1,
                drill: id === -1 ? drill.report("profit-and-loss", { dateFrom: current.fy.start, dateTo: asAt }) : drill.report("gl-account-activity", { accountId: String(id), dateFrom: current.fy.start, dateTo: asAt }),
              },
            ),
          );
        }
        rows.push(subtotalRow({ label: `Total ${c.label}`, current: c.total, prior: p.total }));
      };
      sectionRows("assets");
      rows.push(totalRow({ label: "Total Assets", current: current.sheet.totalAssets, prior: prior.sheet.totalAssets }));
      sectionRows("liabilities");
      sectionRows("equity");
      rows.push(totalRow({ label: "Total Liabilities & Equity", current: current.sheet.totalLiabilitiesAndEquity, prior: prior.sheet.totalLiabilitiesAndEquity }));
      const tbBalanced = (tb: typeof current.tb) => check(`Trial Balance balances`, sum(tb, (r) => r.debitBalance), sum(tb, (r) => r.creditBalance));
      return {
        subtitle: `${asAtLabel(asAt)} · comparative ${formatDate(compareAt)}`,
        summary: [summaryMoney("Total Assets", current.sheet.totalAssets), summaryMoney("Total Liabilities", current.sheet.liabilities.total), summaryMoney("Total Equity", current.sheet.equity.total)],
        sections: [section([col("label", ""), col("current", formatDate(asAt), "money"), col("prior", formatDate(compareAt), "money")], rows)],
        checks: [
          check(`Assets equal liabilities plus equity (${formatDate(asAt)})`, current.sheet.totalAssets, current.sheet.totalLiabilitiesAndEquity),
          { ...tbBalanced(current.tb), label: `Trial Balance at ${asAt} balances` },
          check(`Assets equal liabilities plus equity (${formatDate(compareAt)})`, prior.sheet.totalAssets, prior.sheet.totalLiabilitiesAndEquity),
        ],
        notices: ["Current Year Earnings is the year-to-date net profit from the Profit & Loss (no closing entries are needed for the sheet to balance)."],
      };
    },
  },
  profitAndLoss("profit-and-loss", "Profit & Loss", "Revenue, cost of sales, gross profit, operating expenses and net profit for a period, grouped by account category.", false),
  profitAndLoss("detailed-profit-and-loss", "Detailed Profit & Loss", "The Profit & Loss with every GL account, each drillable to its postings.", true),
  {
    id: "comparative-profit-and-loss",
    title: "Comparative Profit & Loss",
    description: "The Profit & Loss for two periods side by side with the variance.",
    categories: ["financial", "management"],
    filters: [...F.period, ...F.compare],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const compareFrom = ctx.filters.compareDateFrom || shiftYears(dateFrom, -1);
      const compareTo = ctx.filters.compareDateTo || shiftYears(dateTo, -1);
      const [current, prior, accounts] = await Promise.all([incomeStatementFor(ctx, dateFrom, dateTo), incomeStatementFor(ctx, compareFrom, compareTo), ctx.source.accounts()]);
      const rows = profitAndLossRows(
        [
          { key: "current", label: "Current", from: dateFrom, to: dateTo, statement: current },
          { key: "prior", label: "Comparative", from: compareFrom, to: compareTo, statement: prior },
        ],
        accounts,
        false,
        ([c, p]) => ({ variance: round2(c - p), variancePct: p !== 0 ? round2(((c - p) / Math.abs(p)) * 100) : null }),
      );
      return {
        subtitle: `${periodLabel(dateFrom, dateTo)} vs ${periodLabel(compareFrom, compareTo)}`,
        summary: [summaryMoney("Net Profit (current)", current.netProfit), summaryMoney("Net Profit (comparative)", prior.netProfit), summaryMoney("Variance", round2(current.netProfit - prior.netProfit))],
        sections: [section([col("label", ""), col("current", periodLabel(dateFrom, dateTo), "money"), col("prior", periodLabel(compareFrom, compareTo), "money"), col("variance", "Variance", "money"), col("variancePct", "Variance %", "percent")], rows)],
        checks: [],
        notices: ["Variance is current minus comparative; a comparative with no postings shows as zero, not as an estimate."],
      };
    },
  },
  {
    id: "monthly-profit-and-loss",
    title: "Monthly Profit & Loss",
    description: "The Profit & Loss by month across the period, with a total column.",
    categories: ["financial", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const months = monthsBetween(dateFrom, dateTo).slice(0, 24);
      const [accounts, ...statements] = await Promise.all([
        ctx.source.accounts(),
        ...months.map((m, i) => incomeStatementFor(ctx, i === 0 ? dateFrom : `${m}-01`, i === months.length - 1 ? (dateTo < monthEnd(m) ? dateTo : monthEnd(m)) : monthEnd(m))),
      ]);
      const total = await incomeStatementFor(ctx, dateFrom, months.length ? (dateTo < monthEnd(months[months.length - 1]) ? dateTo : monthEnd(months[months.length - 1])) : dateTo);
      const periods: Period[] = months.map((m, i) => ({ key: m, label: monthLabel(m), from: `${m}-01`, to: monthEnd(m), statement: statements[i] as IncomeStatement }));
      periods.push({ key: "total", label: "Total", from: dateFrom, to: dateTo, statement: total });
      const rows = profitAndLossRows(periods, accounts, false);
      const monthSum = round2(statements.reduce((s, st) => s + (st as IncomeStatement).netProfit, 0));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Net Profit", total.netProfit), summaryText("Months", String(months.length))],
        sections: [section([col("label", ""), ...periods.map((p): ReportColumn => col(p.key, p.label, "money"))], rows)],
        checks: [check("Monthly net profits add up to the period total", total.netProfit, monthSum)],
        notices: monthsBetween(dateFrom, dateTo).length > 24 ? ["Shows the first 24 months of the period."] : [],
      };
    },
  },
  {
    id: "annual-profit-and-loss",
    title: "Annual Profit & Loss",
    description: "The Profit & Loss for each financial year side by side.",
    categories: ["financial", "management"],
    filters: [{ key: "dateTo", label: "Up to", control: "date" }],
    async build(ctx) {
      const { dateTo } = ctx.filters;
      const recorded = (await ctx.source.financialYears()).filter((y) => y.startDate <= dateTo).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
      let years = recorded.slice(-5).map((y) => ({ label: y.yearLabel, start: y.startDate, end: y.endDate < dateTo ? y.endDate : dateTo }));
      if (years.length === 0) {
        const current = await financialYearFor(ctx, dateTo);
        const previous = await financialYearFor(ctx, dayBefore(current.start));
        years = [
          { label: previous.label, start: previous.start, end: previous.end },
          { label: current.label, start: current.start, end: dateTo },
        ];
      }
      const [accounts, ...statements] = await Promise.all([ctx.source.accounts(), ...years.map((y) => incomeStatementFor(ctx, y.start, y.end))]);
      const periods: Period[] = years.map((y, i) => ({ key: `fy${i}`, label: y.label, from: y.start, to: y.end, statement: statements[i] as IncomeStatement }));
      return {
        subtitle: `${years.length} financial years to ${formatDate(dateTo)}`,
        summary: periods.map((p) => summaryMoney(`Net Profit ${p.label}`, p.statement.netProfit)),
        sections: [section([col("label", ""), ...periods.map((p): ReportColumn => col(p.key, p.label, "money"))], profitAndLossRows(periods, accounts, false))],
        checks: [],
        notices: recorded.length === 0 ? ["No financial years are recorded for this company; years are derived from its financial-year start month."] : ["The current financial year runs to the chosen date."],
      };
    },
  },
  {
    id: "budget-vs-actual",
    title: "Budget vs Actual",
    description: "Captured budgets against actual income and expense for the financial year to date. Only shown where a budget exists.",
    categories: ["financial", "management"],
    filters: [{ key: "dateTo", label: "Year to", control: "date" }],
    async build(ctx) {
      const { dateTo } = ctx.filters;
      const fy = await financialYearFor(ctx, dateTo);
      const [budgets, accounts, statement] = await Promise.all([ctx.source.budgets(), ctx.source.accounts(), incomeStatementFor(ctx, fy.start, dateTo)]);
      const inYear = budgets.filter((b) => b.financialYearLabel === fy.label);
      const byId = accountsById(accounts);
      const actualById = new Map([statement.revenue, statement.costOfSales, statement.operatingExpenses, statement.otherIncome, statement.otherExpense].flatMap((s) => s.lines).map((l) => [l.accountId, l.amount]));
      const budgetByAccount = new Map<number, number>();
      for (const b of inYear) budgetByAccount.set(b.accountId, round2((budgetByAccount.get(b.accountId) ?? 0) + b.amount));
      const rows = [...budgetByAccount.entries()]
        .map(([accountId, budget]) => ({ account: byId.get(accountId), accountId, budget, actual: actualById.get(accountId) ?? 0 }))
        .sort((a, b) => (a.account?.accountCode ?? "").localeCompare(b.account?.accountCode ?? "", undefined, { numeric: true }))
        .map((r) =>
          row(
            { code: r.account?.accountCode ?? "", account: r.account?.description ?? `Account #${r.accountId} (not in chart)`, budget: r.budget, actual: r.actual, variance: round2(r.actual - r.budget), variancePct: r.budget !== 0 ? round2(((r.actual - r.budget) / Math.abs(r.budget)) * 100) : null },
            r.account ? { drill: drill.report("gl-account-activity", { accountId: String(r.accountId), dateFrom: fy.start, dateTo }) } : {},
          ),
        );
      const totalBudget = sum(inYear, (b) => b.amount);
      const totalActual = sum([...budgetByAccount.keys()], (id) => actualById.get(id) ?? 0);
      if (rows.length > 0) rows.push(totalRow({ account: "Total", budget: totalBudget, actual: totalActual, variance: round2(totalActual - totalBudget) }));
      return {
        subtitle: `${fy.label} · ${periodLabel(fy.start, dateTo)}`,
        summary: rows.length > 0 ? [summaryMoney("Budget", totalBudget), summaryMoney("Actual", totalActual), summaryMoney("Variance", round2(totalActual - totalBudget))] : [],
        sections: [section([col("code", "Code"), col("account", "Account"), col("budget", "Budget", "money"), col("actual", "Actual", "money"), col("variance", "Variance", "money"), col("variancePct", "Variance %", "percent")], rows, undefined, `No budget has been captured for ${fy.label}. Budgets are captured under Reporting → Budgets & Forecasts (Management Reports tab); nothing is estimated here.`)],
        checks: [],
        notices: ["Actuals are signed like the Profit & Loss (income credit-positive, expenses debit-positive). A budget for the full year is compared with actuals to date."],
      };
    },
  },
  {
    id: "cash-flow",
    title: "Cash Flow Statement",
    description: "Operating, investing and financing cash flows (indirect method), reconciled to the actual movement in cash and bank accounts.",
    categories: ["financial", "banking"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [accounts, start, end] = await Promise.all([ctx.source.accounts(), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo)]);
      const statement = buildIncomeStatement(accounts, start, end, dateFrom, dateTo);
      const cashIds = identifyCashAccountIds(accounts);
      const cf = buildCashFlowStatement(accounts, start, end, dateFrom, dateTo, statement.netProfit, cashIds);
      const rows: ReportRow[] = [];
      for (const s of [cf.operatingActivities, cf.investingActivities, cf.financingActivities]) {
        rows.push(groupRow({ label: s.label }));
        for (const l of s.lines) {
          rows.push(row({ label: l.accountCode ? `${l.accountCode} ${l.description}` : l.description, amount: l.amount }, { level: 1, ...(l.accountId > 0 ? { drill: drill.report("gl-account-activity", { accountId: String(l.accountId), dateFrom, dateTo }) } : {}) }));
        }
        rows.push(subtotalRow({ label: `Net cash from ${s.label.toLowerCase()}`, amount: s.total }));
      }
      rows.push(totalRow({ label: "Net change in cash", amount: cf.netChangeInCash }));
      rows.push(row({ label: "Opening cash and bank", amount: cf.openingCash }));
      rows.push(row({ label: "Closing cash and bank", amount: cf.closingCash }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Net Profit", statement.netProfit), summaryMoney("Net Change in Cash", cf.netChangeInCash), summaryMoney("Closing Cash", cf.closingCash)],
        sections: [section([col("label", ""), col("amount", periodLabel(dateFrom, dateTo), "money")], rows)],
        checks: [check("Cash flows equal the actual movement in cash and bank accounts", cf.actualCashMovement, cf.netChangeInCash, "Cash and bank accounts are identified by name (Asset accounts containing 'bank' or 'cash') — the same rule the Financial Statements page uses.")],
        notices: [`Cash accounts: ${accounts.filter((a) => cashIds.includes(a.id)).map((a) => `${a.accountCode} ${a.description}`).join(", ") || "none identified"}.`],
      };
    },
  },
];

export { grossMarginPercent };
