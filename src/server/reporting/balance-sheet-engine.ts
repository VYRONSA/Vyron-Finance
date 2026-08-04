/**
 * Pure Balance Sheet engine — no Supabase. A single Trial Balance
 * snapshot as-of the report date (same primitive Trial Balance itself
 * uses — no second GL query path).
 *
 * This platform has no year-end closing mechanism (Income/Expense
 * accounts are never swept to Retained Income) — confirmed by research
 * before writing this. So a Balance Sheet built from a raw Trial Balance
 * alone would NOT balance once the current financial year has posted any
 * profit or loss. The honest fix, not a hack: fold the current period's
 * Net Profit (computed by `income-statement-engine.ts` for the
 * year-to-date, as of the same date) into Equity as an explicit
 * "Current Year Earnings" line — exactly what a real closing entry would
 * eventually produce, just not persisted as one yet.
 */

import type { AccountType, ChartOfAccount, TrialBalanceRow } from "@/server/general-ledger/types";
import type { StatementLine, StatementSection } from "./income-statement-engine";

export type BalanceSheet = {
  asOfDate: string;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
};

const BALANCE_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSection(label: string, accounts: ChartOfAccount[], rowsById: Map<number, TrialBalanceRow>, accountType: AccountType, creditPositive: boolean): StatementSection {
  const lines: StatementLine[] = [];
  for (const account of accounts) {
    if (account.accountType !== accountType) continue;
    const row = rowsById.get(account.id);
    if (!row) continue;
    const amount = round2(creditPositive ? row.creditBalance - row.debitBalance : row.debitBalance - row.creditBalance);
    if (amount === 0) continue; // zero-balance account this period — omit, not fabricate a zero row
    lines.push({ accountId: account.id, accountCode: account.accountCode, description: account.description, reportingGroup: account.reportingGroup, amount });
  }
  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return { label, lines, total: round2(lines.reduce((sum, l) => sum + l.amount, 0)) };
}

/** Pure — assembles Assets / Liabilities / Equity as-of one date, folding
 * `currentYearEarnings` (the year-to-date Net Profit as-of the same
 * date, from `buildIncomeStatement`) into Equity so the sheet balances
 * without a real closing-entry mechanism. */
export function buildBalanceSheet(accounts: ChartOfAccount[], asOfRows: TrialBalanceRow[], asOfDate: string, currentYearEarnings: number): BalanceSheet {
  const rowsById = new Map(asOfRows.map((r) => [r.accountId, r]));

  const assets = buildSection("Assets", accounts, rowsById, "Asset", false);
  const liabilities = buildSection("Liabilities", accounts, rowsById, "Liability", true);
  const equity = buildSection("Equity", accounts, rowsById, "Equity", true);

  if (currentYearEarnings !== 0) {
    equity.lines.push({ accountId: -1, accountCode: "", description: "Current Year Earnings", reportingGroup: "Equity", amount: round2(currentYearEarnings) });
    equity.lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    equity.total = round2(equity.total + currentYearEarnings);
  }

  const totalAssets = assets.total;
  const totalLiabilitiesAndEquity = round2(liabilities.total + equity.total);

  return {
    asOfDate,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilitiesAndEquity,
    isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) <= BALANCE_TOLERANCE,
  };
}
