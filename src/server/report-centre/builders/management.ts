/**
 * Management reporting — the owner's view: performance for the period,
 * the previous period, year to date and the previous year to date,
 * against budget ONLY where a budget has been captured; the financial
 * position (cash, receivables, payables, VAT); and the biggest customers,
 * suppliers and expenses. Every figure is drawn from the same statement
 * engines and subsidiary ledgers as the detailed reports it drills into.
 */

import { identifyCashAccountIds } from "@/server/services/financial-statements-service";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import {
  addDays,
  col,
  controlAccountCheck,
  dayBefore,
  drill,
  F,
  formatDate,
  monthEnd,
  monthKey,
  monthLabel,
  monthsBetween,
  periodLabel,
  row,
  section,
  shiftYears,
  subtotalRow,
  summaryMoney,
  totalRow,
  type ReportContext,
  type ReportDefinition,
} from "../kit";
import { round2, sum, type ReconciliationCheck, type ReportRow, type ReportSection } from "../types";
import { incomeStatementFor, grossMarginPercent } from "./financial";
import { partyLedgerTotals } from "./party";
import { postedPurchaseLines, postedSalesLines } from "./trade";
import { financialYearFor, naturalBalance } from "./shared";

type Windows = { current: [string, string]; previous: [string, string]; ytd: [string, string]; prevYtd: [string, string]; fyLabel: string };

async function windows(ctx: ReportContext): Promise<Windows> {
  const { dateFrom, dateTo } = ctx.filters;
  const days = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000);
  const prevTo = dayBefore(dateFrom);
  const fy = await financialYearFor(ctx, dateTo);
  return { current: [dateFrom, dateTo], previous: [addDays(prevTo, -days), prevTo], ytd: [fy.start, dateTo], prevYtd: [shiftYears(fy.start, -1), shiftYears(dateTo, -1)], fyLabel: fy.label };
}

type Kpi = { label: string; value: (s: IncomeStatement) => number | null; kind: "money" | "percent"; budget?: (b: BudgetTotals) => number | null };
type BudgetTotals = { revenue: number; costOfSales: number; expenses: number; otherIncome: number; otherExpense: number; any: boolean };

const KPIS: Kpi[] = [
  { label: "Revenue", value: (s) => s.revenue.total, kind: "money", budget: (b) => (b.any ? b.revenue : null) },
  { label: "Cost of Sales", value: (s) => s.costOfSales.total, kind: "money", budget: (b) => (b.any ? b.costOfSales : null) },
  { label: "Gross Profit", value: (s) => s.grossProfit, kind: "money", budget: (b) => (b.any ? round2(b.revenue - b.costOfSales) : null) },
  { label: "Gross Margin %", value: (s) => grossMarginPercent(s), kind: "percent" },
  { label: "Operating Expenses", value: (s) => s.operatingExpenses.total, kind: "money", budget: (b) => (b.any ? b.expenses : null) },
  { label: "Net Profit", value: (s) => s.netProfit, kind: "money", budget: (b) => (b.any ? round2(b.revenue - b.costOfSales - b.expenses + b.otherIncome - b.otherExpense) : null) },
];

async function budgetTotals(ctx: ReportContext, fyLabel: string): Promise<BudgetTotals> {
  const [budgets, accounts] = await Promise.all([ctx.source.budgets(), ctx.source.accounts()]);
  const typeOf = new Map(accounts.map((a) => [a.id, a.accountType]));
  const t: BudgetTotals = { revenue: 0, costOfSales: 0, expenses: 0, otherIncome: 0, otherExpense: 0, any: false };
  for (const b of budgets) {
    if (b.financialYearLabel !== fyLabel) continue;
    t.any = true;
    const type = typeOf.get(b.accountId);
    if (type === "Income") t.revenue += b.amount;
    else if (type === "Cost of Sales") t.costOfSales += b.amount;
    else if (type === "Expense") t.expenses += b.amount;
    else if (type === "Other Income") t.otherIncome += b.amount;
    else if (type === "Other Expense") t.otherExpense += b.amount;
  }
  return { ...t, revenue: round2(t.revenue), costOfSales: round2(t.costOfSales), expenses: round2(t.expenses), otherIncome: round2(t.otherIncome), otherExpense: round2(t.otherExpense) };
}

async function performanceSection(ctx: ReportContext): Promise<{ section: ReportSection; current: IncomeStatement; ytd: IncomeStatement; w: Windows; budgets: BudgetTotals }> {
  const w = await windows(ctx);
  const [current, previous, ytd, prevYtd, budgets] = await Promise.all([
    incomeStatementFor(ctx, ...w.current),
    incomeStatementFor(ctx, ...w.previous),
    incomeStatementFor(ctx, ...w.ytd),
    incomeStatementFor(ctx, ...w.prevYtd),
    budgetTotals(ctx, w.fyLabel),
  ]);
  const rows = KPIS.map((k) => {
    const c = k.value(current);
    const y = k.value(ytd);
    const b = k.budget?.(budgets) ?? null;
    return row(
      { label: k.label, current: c, previous: k.value(previous), ytd: y, prevYtd: k.value(prevYtd), budget: b, achieved: b && y !== null ? round2((y / b) * 100) : null },
      { drill: drill.report("comparative-profit-and-loss", { dateFrom: w.current[0], dateTo: w.current[1], compareDateFrom: w.previous[0], compareDateTo: w.previous[1] }) },
    );
  });
  const pct = (label: string) => ({ ...col(label === "achieved" ? "achieved" : label, label === "achieved" ? "YTD % of Budget" : label, "percent") });
  return {
    current,
    ytd,
    w,
    budgets,
    section: {
      title: "Performance",
      columns: [col("label", ""), col("current", `Current (${formatDate(w.current[0])} – ${formatDate(w.current[1])})`, "money"), col("previous", "Previous Period", "money"), col("ytd", `YTD ${w.fyLabel}`, "money"), col("prevYtd", "Previous YTD", "money"), col("budget", `Budget ${w.fyLabel} (full year)`, "money"), pct("achieved")],
      rows,
    },
  };
}

async function positionRows(ctx: ReportContext, asAt: string): Promise<{ rows: ReportRow[]; checks: ReconciliationCheck[]; notices: string[]; figures: Record<string, number> }> {
  const [accounts, tb, controls, receivables, payables, bankAccounts] = await Promise.all([
    ctx.source.accounts(),
    ctx.source.trialBalance(asAt),
    ctx.source.controlAccounts(),
    partyLedgerTotals(ctx, "customer", asAt),
    partyLedgerTotals(ctx, "supplier", asAt),
    ctx.source.bankAccounts(),
  ]);
  const cashIds = new Set(identifyCashAccountIds(accounts));
  const cash = sum(tb.filter((r) => cashIds.has(r.accountId)), (r) => r.totalDebit - r.totalCredit);
  let vat = 0;
  for (const v of controls.vat) {
    const r = tb.find((x) => x.accountId === v.accountId);
    if (r) vat += r.totalCredit - r.totalDebit;
  }
  vat = round2(vat);
  const [rc, pc] = await Promise.all([controlAccountCheck(ctx, "customer", receivables.balance, asAt), controlAccountCheck(ctx, "supplier", payables.balance, asAt)]);
  const fy = await financialYearFor(ctx, asAt);
  return {
    figures: { cash, receivables: receivables.balance, payables: payables.balance, vat },
    rows: [
      row({ label: "Cash & bank", value: round2(cash) }, { drill: drill.report("cash-position", { asAt }) }),
      row({ label: "Receivables (customers owe)", value: receivables.balance }, { drill: drill.report("customer-aging", { asAt }) }),
      row({ label: "   of which overdue", value: receivables.overdue }, { level: 1, drill: drill.report("overdue-customers", { asAt }) }),
      row({ label: "Payables (owed to suppliers)", value: payables.balance }, { drill: drill.report("supplier-aging", { asAt }) }),
      row({ label: "   of which overdue", value: payables.overdue }, { level: 1, drill: drill.report("overdue-suppliers", { asAt }) }),
      row({ label: vat >= 0 ? "VAT payable" : "VAT refundable", value: Math.abs(vat) }, { drill: drill.report("vat-position", { asAt }) }),
      subtotalRow({ label: "Net working capital (cash + receivables − payables − VAT payable)", value: round2(cash + receivables.balance - payables.balance - vat) }),
    ],
    checks: [...rc.checks, ...pc.checks],
    notices: [...rc.notices, ...pc.notices, ...(bankAccounts.length === 0 ? ["No bank accounts are set up."] : []), `Financial year ${fy.label}.`],
  };
}

async function topParties(ctx: ReportContext, side: "sales" | "purchases", limit: number): Promise<ReportRow[]> {
  const { dateFrom, dateTo } = ctx.filters;
  const lines = side === "sales" ? await postedSalesLines(ctx, dateFrom, dateTo) : await postedPurchaseLines(ctx, dateFrom, dateTo);
  const totals = new Map<number, { name: string; net: number; docs: Set<number> }>();
  for (const l of lines) {
    const t = totals.get(l.partyId) ?? { name: l.partyName, net: 0, docs: new Set<number>() };
    t.net = round2(t.net + l.net);
    t.docs.add(l.docId);
    totals.set(l.partyId, t);
  }
  const grand = sum(lines, (l) => l.net);
  return [...totals.entries()]
    .sort((a, b) => b[1].net - a[1].net)
    .slice(0, limit)
    .map(([id, t], i) =>
      row(
        { rank: i + 1, name: t.name, documents: t.docs.size, net: t.net, share: grand ? round2((t.net / grand) * 100) : null },
        { drill: drill.report(side === "sales" ? "customer-detailed-ledger" : "supplier-detailed-ledger", { [side === "sales" ? "customerId" : "supplierId"]: String(id), dateFrom, dateTo }) },
      ),
    );
}

const TOP_COLUMNS = (label: string) => [col("rank", "#", "number"), col("name", label), col("documents", "Documents", "number"), col("net", "Net", "money"), col("share", "% of Total", "percent")];

function largestExpenseRows(statement: IncomeStatement, dateFrom: string, dateTo: string, limit: number): ReportRow[] {
  const lines = [...statement.costOfSales.lines, ...statement.operatingExpenses.lines, ...statement.otherExpense.lines].sort((a, b) => b.amount - a.amount).slice(0, limit);
  const total = round2(statement.costOfSales.total + statement.operatingExpenses.total + statement.otherExpense.total);
  return lines.map((l, i) => row({ rank: i + 1, account: `${l.accountCode} ${l.description}`, amount: l.amount, share: total ? round2((l.amount / total) * 100) : null }, { drill: drill.report("gl-account-activity", { accountId: String(l.accountId), dateFrom, dateTo }) }));
}

async function trendRows(ctx: ReportContext, monthsBack: number): Promise<ReportRow[]> {
  const { dateTo } = ctx.filters;
  const months = monthsBetween(shiftYears(dateTo, -1), dateTo).slice(-monthsBack);
  const [sales, ...statements] = await Promise.all([postedSalesLines(ctx, `${months[0]}-01`, dateTo), ...months.map((m) => incomeStatementFor(ctx, `${m}-01`, monthEnd(m) < dateTo ? monthEnd(m) : dateTo))]);
  return months.map((m, i) => {
    const s = statements[i] as IncomeStatement;
    return row({ month: monthLabel(m), sales: sum(sales.filter((l) => monthKey(l.date) === m), (l) => l.net), revenue: s.revenue.total, expenses: round2(s.costOfSales.total + s.operatingExpenses.total + s.otherExpense.total), netProfit: s.netProfit }, { drill: drill.report("profit-and-loss", { dateFrom: `${m}-01`, dateTo: monthEnd(m) }) });
  });
}

async function bankMovementRows(ctx: ReportContext): Promise<ReportRow[]> {
  const { dateFrom, dateTo } = ctx.filters;
  const [bankAccounts, start, end] = await Promise.all([ctx.source.bankAccounts(), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo)]);
  const rows: ReportRow[] = [];
  for (const b of bankAccounts) {
    const code = b.glAccount?.trim();
    const e = code ? end.find((r) => r.accountCode === code) : undefined;
    const s = code ? start.find((r) => r.accountCode === code) : undefined;
    if (!e) {
      rows.push(row({ account: `${b.accountName} (${b.accountNumber})`, note: code ? `GL account ${code} not in chart` : "No GL account configured" }));
      continue;
    }
    rows.push(
      row(
        { account: `${b.accountName} (${b.accountNumber})`, opening: naturalBalance("Debit", s?.totalDebit ?? 0, s?.totalCredit ?? 0), in: round2(e.totalDebit - (s?.totalDebit ?? 0)), out: round2(e.totalCredit - (s?.totalCredit ?? 0)), closing: naturalBalance("Debit", e.totalDebit, e.totalCredit) },
        { drill: drill.report("bank-ledger", { bankAccountId: String(b.id), dateFrom, dateTo }) },
      ),
    );
  }
  return rows;
}

const BANK_COLUMNS = [col("account", "Bank Account"), col("opening", "Opening", "money"), col("in", "Money In", "money"), col("out", "Money Out", "money"), col("closing", "Closing", "money"), col("note", "")];

export const MANAGEMENT_REPORTS: ReportDefinition[] = [
  {
    id: "management-pack",
    title: "Management Pack",
    description: "The business owner's pack: performance vs previous period, year to date and budget; cash, receivables, payables and VAT; top customers and suppliers; largest expenses; trends and bank movement.",
    categories: ["management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const perf = await performanceSection(ctx);
      const [position, topCustomers, topSuppliers, trends, bank] = await Promise.all([positionRows(ctx, dateTo), topParties(ctx, "sales", 5), topParties(ctx, "purchases", 5), trendRows(ctx, 12), bankMovementRows(ctx)]);
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Revenue", perf.current.revenue.total), summaryMoney("Net Profit", perf.current.netProfit), summaryMoney("Cash & Bank", position.figures.cash), summaryMoney("Receivables", position.figures.receivables), summaryMoney("Payables", position.figures.payables)],
        sections: [
          perf.section,
          section([col("label", ""), col("value", formatDate(dateTo), "money")], position.rows, "Financial Position"),
          section(TOP_COLUMNS("Customer"), topCustomers, "Top Customers", "No sales in this period."),
          section(TOP_COLUMNS("Supplier"), topSuppliers, "Top Suppliers", "No purchases in this period."),
          section([col("rank", "#", "number"), col("account", "Expense Account"), col("amount", "Amount", "money"), col("share", "% of Costs", "percent")], largestExpenseRows(perf.current, dateFrom, dateTo, 10), "Largest Expenses", "No expenses in this period."),
          section([col("month", "Month"), col("sales", "Net Sales (documents)", "money"), col("revenue", "Revenue (P&L)", "money"), col("expenses", "Costs (P&L)", "money"), col("netProfit", "Net Profit", "money")], trends, "Sales & Expense Trend (12 months)"),
          section(BANK_COLUMNS, bank, "Bank Movement (per General Ledger)", "No bank accounts are set up."),
        ],
        checks: position.checks,
        notices: [
          ...position.notices,
          perf.budgets.any ? `Budget is the full-year budget captured for ${perf.w.fyLabel}; "YTD % of Budget" shows how much of it the year to date represents.` : `No budget has been captured for ${perf.w.fyLabel}, so no budget comparison is shown.`,
          "Previous Period is the same number of days immediately before the current period; Previous YTD is the same span one year earlier.",
        ],
      };
    },
  },
  {
    id: "kpi-comparison",
    title: "Performance Comparison",
    description: "Revenue, gross profit and margin, operating expenses and net profit for the current period, previous period, year to date, previous year to date and budget.",
    categories: ["management", "financial"],
    filters: [...F.period],
    async build(ctx) {
      const perf = await performanceSection(ctx);
      return {
        subtitle: periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo),
        summary: [summaryMoney("Revenue", perf.current.revenue.total), summaryMoney("Net Profit", perf.current.netProfit), summaryMoney("Net Profit YTD", perf.ytd.netProfit)],
        sections: [perf.section],
        checks: [],
        notices: [perf.budgets.any ? `Budget is the full-year budget for ${perf.w.fyLabel}.` : `No budget has been captured for ${perf.w.fyLabel}.`],
      };
    },
  },
  {
    id: "top-customers",
    title: "Top Customers",
    description: "The 20 customers with the highest net sales in the period.",
    categories: ["management", "customers"],
    filters: [...F.period],
    async build(ctx) {
      const rows = await topParties(ctx, "sales", 20);
      return { subtitle: periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo), summary: [summaryMoney("Top 20 net sales", sum(rows, (r) => Number(r.cells.net ?? 0)))], sections: [section(TOP_COLUMNS("Customer"), rows, undefined, "No sales in this period.")], checks: [], notices: [] };
    },
  },
  {
    id: "top-suppliers",
    title: "Top Suppliers",
    description: "The 20 suppliers with the highest net purchases in the period.",
    categories: ["management", "suppliers"],
    filters: [...F.period],
    async build(ctx) {
      const rows = await topParties(ctx, "purchases", 20);
      return { subtitle: periodLabel(ctx.filters.dateFrom, ctx.filters.dateTo), summary: [summaryMoney("Top 20 net purchases", sum(rows, (r) => Number(r.cells.net ?? 0)))], sections: [section(TOP_COLUMNS("Supplier"), rows, undefined, "No purchases in this period.")], checks: [], notices: ["Posted bills only; see Supplier Spend Analysis for spend paid directly from the bank."] };
    },
  },
  {
    id: "largest-expenses",
    title: "Largest Expenses",
    description: "The 25 largest cost and expense accounts in the period.",
    categories: ["management", "financial"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const statement = await incomeStatementFor(ctx, dateFrom, dateTo);
      const rows = largestExpenseRows(statement, dateFrom, dateTo, 25);
      return { subtitle: periodLabel(dateFrom, dateTo), summary: [summaryMoney("Total costs", round2(statement.costOfSales.total + statement.operatingExpenses.total + statement.otherExpense.total))], sections: [section([col("rank", "#", "number"), col("account", "Expense Account"), col("amount", "Amount", "money"), col("share", "% of Costs", "percent")], rows, undefined, "No expenses in this period.")], checks: [], notices: [] };
    },
  },
  {
    id: "expense-trend",
    title: "Sales & Expense Trend",
    description: "Monthly net sales, revenue, costs and net profit for the 12 months to the chosen date.",
    categories: ["management"],
    filters: [{ key: "dateTo", label: "To", control: "date" }],
    async build(ctx) {
      const rows = await trendRows(ctx, 12);
      rows.push(totalRow({ month: "Total", sales: sum(rows, (r) => Number(r.cells.sales ?? 0)), revenue: sum(rows, (r) => Number(r.cells.revenue ?? 0)), expenses: sum(rows, (r) => Number(r.cells.expenses ?? 0)), netProfit: sum(rows, (r) => Number(r.cells.netProfit ?? 0)) }));
      return { subtitle: `12 months to ${formatDate(ctx.filters.dateTo)}`, summary: [], sections: [section([col("month", "Month"), col("sales", "Net Sales (documents)", "money"), col("revenue", "Revenue (P&L)", "money"), col("expenses", "Costs (P&L)", "money"), col("netProfit", "Net Profit", "money")], rows)], checks: [], notices: [] };
    },
  },
  {
    id: "cash-position",
    title: "Cash Position",
    description: "Every cash and bank account's balance in the General Ledger as at a date.",
    categories: ["management", "banking"],
    filters: [F.asAt],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const [accounts, tb] = await Promise.all([ctx.source.accounts(), ctx.source.trialBalance(asAt)]);
      const cashIds = new Set(identifyCashAccountIds(accounts));
      const fy = await financialYearFor(ctx, asAt);
      const lines = tb.filter((r) => cashIds.has(r.accountId));
      const rows = lines.map((r) => row({ code: r.accountCode, account: r.description, balance: round2(r.totalDebit - r.totalCredit) }, { drill: drill.report("gl-account-activity", { accountId: String(r.accountId), dateFrom: fy.start, dateTo: asAt }) }));
      const total = sum(lines, (r) => r.totalDebit - r.totalCredit);
      rows.push(totalRow({ account: "Total cash & bank", balance: total }));
      return { subtitle: `As at ${formatDate(asAt)}`, summary: [summaryMoney("Cash & Bank", total)], sections: [section([col("code", "Code"), col("account", "Account"), col("balance", "Balance", "money")], rows, undefined, "No cash or bank accounts identified.")], checks: [], notices: ["Cash and bank accounts are Asset accounts named 'bank' or 'cash' — the rule the Cash Flow Statement uses."] };
    },
  },
  {
    id: "vat-position",
    title: "VAT Position",
    description: "The balance on each VAT account as at a date and the resulting net VAT payable or refundable.",
    categories: ["management", "vat"],
    filters: [F.asAt],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const [tb, controls] = await Promise.all([ctx.source.trialBalance(asAt), ctx.source.controlAccounts()]);
      const rows = controls.vat.map((v) => {
        const r = tb.find((x) => x.accountId === v.accountId);
        return row({ account: `${v.accountCode} ${v.description}`, role: v.role, debit: r?.debitBalance || null, credit: r?.creditBalance || null, payable: round2((r?.totalCredit ?? 0) - (r?.totalDebit ?? 0)) }, { drill: drill.report("vat-control-account", { dateTo: asAt }) });
      });
      const net = sum(controls.vat, (v) => {
        const r = tb.find((x) => x.accountId === v.accountId);
        return (r?.totalCredit ?? 0) - (r?.totalDebit ?? 0);
      });
      rows.push(totalRow({ account: net >= 0 ? "Net VAT payable" : "Net VAT refundable", payable: net }));
      return { subtitle: `As at ${formatDate(asAt)}`, summary: [summaryMoney(net >= 0 ? "VAT Payable" : "VAT Refundable", Math.abs(net))], sections: [section([col("account", "VAT Account"), col("role", "Role"), col("debit", "Debit", "money"), col("credit", "Credit", "money"), col("payable", "Payable (+) / Refundable (−)", "money")], rows, undefined, "No VAT accounts exist in the Chart of Accounts.")], checks: [], notices: [] };
    },
  },
  overdue("overdue-customers", "Overdue Customers", "customer"),
  overdue("overdue-suppliers", "Overdue Suppliers", "supplier"),
];

function overdue(id: string, title: string, side: "customer" | "supplier"): ReportDefinition {
  return {
    id,
    title,
    description: `${side === "customer" ? "Customers" : "Suppliers"} with overdue amounts as at a date, most overdue first.`,
    categories: ["management", side === "customer" ? "customers" : "suppliers"],
    filters: [F.asAt],
    async build(ctx) {
      const { asAt } = ctx.filters;
      const [totals, parties] = await Promise.all([partyLedgerTotals(ctx, side, asAt), side === "customer" ? ctx.source.customers() : ctx.source.suppliers()]);
      const names = new Map(parties.map((p) => [p.id, p.name]));
      const list = totals.aging.filter((a) => a.days30 + a.days60 + a.days90 + a.days120Plus > 0).sort((a, b) => b.days120Plus + b.days90 - (a.days120Plus + a.days90) || b.balance - a.balance);
      const rows = list.map((a) =>
        row(
          { name: names.get(a.partyId) ?? `#${a.partyId}`, days30: a.days30, days60: a.days60, days90: a.days90, days120Plus: a.days120Plus, overdue: round2(a.days30 + a.days60 + a.days90 + a.days120Plus), balance: a.balance },
          { drill: drill.report(`${side}-statement`, { [side === "customer" ? "customerId" : "supplierId"]: String(a.partyId), dateTo: asAt }) },
        ),
      );
      rows.push(totalRow({ name: "Total", overdue: sum(list, (a) => a.days30 + a.days60 + a.days90 + a.days120Plus), balance: sum(list, (a) => a.balance) }));
      return {
        subtitle: `As at ${formatDate(asAt)}`,
        summary: [summaryMoney("Overdue", totals.overdue)],
        sections: [section([col("name", side === "customer" ? "Customer" : "Supplier"), col("days30", "1–30", "money"), col("days60", "31–60", "money"), col("days90", "61–90", "money"), col("days120Plus", "90+", "money"), col("overdue", "Overdue", "money"), col("balance", "Balance", "money")], rows, undefined, "Nothing overdue.")],
        checks: [],
        notices: [],
      };
    },
  };
}
