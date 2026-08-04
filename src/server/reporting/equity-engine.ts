/**
 * Pure Statement of Changes in Equity engine — no Supabase. The 4th
 * primary statement (Statement of Financial Position/Profit or
 * Loss/Cash Flows already exist as `balance-sheet-engine.ts`/
 * `income-statement-engine.ts`/`cash-flow-engine.ts`); this file follows
 * the exact same two-Trial-Balance-snapshot-diff technique those three
 * already established — reusing `computePeriodMovements` rather than a
 * fourth GL-diffing implementation.
 *
 * This platform has no year-end closing mechanism (confirmed by
 * `balance-sheet-engine.ts`'s own docstring): the period's Net Profit is
 * never posted into a real Equity account. So, exactly like the Balance
 * Sheet engine's synthetic "Current Year Earnings" line, this engine adds
 * one synthetic "Profit for the Period" row (id `-1`) rather than
 * attributing it to a real account — keeping this statement's total
 * closing balance identically equal to the Balance Sheet's total Equity
 * for the same date, by construction.
 */

import type { ChartOfAccount, TrialBalanceRow } from "@/server/general-ledger/types";
import { computePeriodMovements } from "./income-statement-engine";

export type EquityComponentRow = {
  accountId: number;
  accountCode: string;
  description: string;
  openingBalance: number;
  movements: number;
  closingBalance: number;
};

export type StatementOfChangesInEquity = {
  periodStart: string;
  periodEnd: string;
  rows: EquityComponentRow[];
  totalOpeningBalance: number;
  totalMovements: number;
  totalClosingBalance: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function equityBalance(row: TrialBalanceRow | undefined): number {
  if (!row) return 0;
  return round2(row.creditBalance - row.debitBalance); // Equity is credit-positive, same convention as balance-sheet-engine.ts
}

/** Pure — `openingRows` should be the Trial Balance as-of the day before
 * `periodStart` (the same snapshot every other statement's opening
 * position uses); `closingRows` as-of `periodEnd`. `netProfitForPeriod`
 * is the Income Statement's own `netProfit` for the identical period —
 * reused, never recomputed here. */
export function buildStatementOfChangesInEquity(
  accounts: ChartOfAccount[],
  openingRows: TrialBalanceRow[],
  closingRows: TrialBalanceRow[],
  periodStart: string,
  periodEnd: string,
  netProfitForPeriod: number,
): StatementOfChangesInEquity {
  const openingById = new Map(openingRows.map((r) => [r.accountId, r]));
  const closingById = new Map(closingRows.map((r) => [r.accountId, r]));
  const movements = computePeriodMovements(accounts, openingRows, closingRows);

  const rows: EquityComponentRow[] = [];
  for (const account of accounts) {
    if (account.accountType !== "Equity") continue;
    const openingBalance = equityBalance(openingById.get(account.id));
    const closingBalance = equityBalance(closingById.get(account.id));
    const movement = movements.get(account.id);
    const netMovement = movement ? round2(movement.periodCredit - movement.periodDebit) : round2(closingBalance - openingBalance);
    if (openingBalance === 0 && closingBalance === 0 && netMovement === 0) continue; // no balance and no activity — omit, not fabricate a zero row
    rows.push({ accountId: account.id, accountCode: account.accountCode, description: account.description, openingBalance, movements: netMovement, closingBalance });
  }
  rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  if (netProfitForPeriod !== 0) {
    rows.push({ accountId: -1, accountCode: "", description: "Profit for the Period", openingBalance: 0, movements: round2(netProfitForPeriod), closingBalance: round2(netProfitForPeriod) });
  }

  return {
    periodStart,
    periodEnd,
    rows,
    totalOpeningBalance: round2(rows.reduce((sum, r) => sum + r.openingBalance, 0)),
    totalMovements: round2(rows.reduce((sum, r) => sum + r.movements, 0)),
    totalClosingBalance: round2(rows.reduce((sum, r) => sum + r.closingBalance, 0)),
  };
}
