/**
 * Pure Income Statement engine — no Supabase. `fn_trial_balance` (see
 * `trial-balance-service.ts`) has no date-range parameter, only a
 * point-in-time `asOfDate`, so a PERIOD movement is computed here as the
 * difference between two Trial Balance snapshots (as-of `periodEnd`, and
 * as-of the day before `periodStart`) — reusing the one real GL
 * aggregate twice rather than adding a second GL query path or looping
 * per-account `getAccountActivity` calls (N+1). Every figure here traces
 * back to `chart_of_accounts` + `gl_transactions` — nothing duplicated,
 * nothing invented.
 *
 * Sign convention: Income/Other Income accounts are presented
 * credit-positive (period credit movement minus period debit movement),
 * Cost of Sales/Expense/Other Expense accounts debit-positive — applied
 * uniformly by `accountType`, not by each account's own `normalBalance`,
 * so a contra account (e.g. a Debit-normal "Sales Returns" categorized
 * as Income) correctly nets AGAINST its section rather than adding to it.
 */

import type { AccountType, ChartOfAccount, TrialBalanceRow } from "@/server/general-ledger/types";

export type StatementLine = {
  accountId: number;
  accountCode: string;
  description: string;
  reportingGroup: string;
  amount: number;
};

export type StatementSection = {
  label: string;
  lines: StatementLine[];
  total: number;
};

export type IncomeStatement = {
  periodStart: string;
  periodEnd: string;
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: number;
  operatingExpenses: StatementSection;
  operatingProfit: number;
  otherIncome: StatementSection;
  otherExpense: StatementSection;
  netProfit: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure — the one place a Trial Balance snapshot pair becomes per-account
 * period movement. Exported (not just used internally) so the Cash Flow
 * engine can reuse it for the same two-snapshot-diff technique without
 * re-deriving the join logic. */
export function computePeriodMovements(
  accounts: ChartOfAccount[],
  startRows: TrialBalanceRow[],
  endRows: TrialBalanceRow[],
): Map<number, { periodDebit: number; periodCredit: number; account: ChartOfAccount }> {
  const startById = new Map(startRows.map((r) => [r.accountId, r]));
  const endById = new Map(endRows.map((r) => [r.accountId, r]));
  const result = new Map<number, { periodDebit: number; periodCredit: number; account: ChartOfAccount }>();

  for (const account of accounts) {
    const start = startById.get(account.id);
    const end = endById.get(account.id);
    if (!end) continue; // account didn't exist as of periodEnd's snapshot — nothing to report
    const periodDebit = round2(end.totalDebit - (start?.totalDebit ?? 0));
    const periodCredit = round2(end.totalCredit - (start?.totalCredit ?? 0));
    result.set(account.id, { periodDebit, periodCredit, account });
  }
  return result;
}

// Cost of Sales / Expense / Other Expense fall through to the debit-positive branch below.
const CREDIT_POSITIVE_TYPES: AccountType[] = ["Income", "Other Income"];

function buildSection(
  label: string,
  movements: Map<number, { periodDebit: number; periodCredit: number; account: ChartOfAccount }>,
  accountType: AccountType,
): StatementSection {
  const creditPositive = CREDIT_POSITIVE_TYPES.includes(accountType);
  const lines: StatementLine[] = [];
  for (const { periodDebit, periodCredit, account } of movements.values()) {
    if (account.accountType !== accountType) continue;
    const amount = round2(creditPositive ? periodCredit - periodDebit : periodDebit - periodCredit);
    if (amount === 0 && periodDebit === 0 && periodCredit === 0) continue; // no activity this period — omit, not fabricate a zero row
    lines.push({ accountId: account.id, accountCode: account.accountCode, description: account.description, reportingGroup: account.reportingGroup, amount });
  }
  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return { label, lines, total: round2(lines.reduce((sum, l) => sum + l.amount, 0)) };
}

/** Pure — assembles the full Revenue → Gross Profit → Operating Profit →
 * Net Profit chain the PRB requires, from two Trial Balance snapshots
 * plus the Chart of Accounts (for type/reporting-group classification). */
export function buildIncomeStatement(
  accounts: ChartOfAccount[],
  startRows: TrialBalanceRow[],
  endRows: TrialBalanceRow[],
  periodStart: string,
  periodEnd: string,
): IncomeStatement {
  const movements = computePeriodMovements(accounts, startRows, endRows);

  const revenue = buildSection("Revenue", movements, "Income");
  const costOfSales = buildSection("Cost of Sales", movements, "Cost of Sales");
  const grossProfit = round2(revenue.total - costOfSales.total);

  const operatingExpenses = buildSection("Operating Expenses", movements, "Expense");
  const operatingProfit = round2(grossProfit - operatingExpenses.total);

  const otherIncome = buildSection("Other Income", movements, "Other Income");
  const otherExpense = buildSection("Other Expense", movements, "Other Expense");
  const netProfit = round2(operatingProfit + otherIncome.total - otherExpense.total);

  return { periodStart, periodEnd, revenue, costOfSales, grossProfit, operatingExpenses, operatingProfit, otherIncome, otherExpense, netProfit };
}
