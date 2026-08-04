/**
 * Application Service layer for Account Activity — opening balance,
 * movements, closing balance, monthly trend, and a year-over-year
 * variance for one account. Ported from the reference's
 * `general_ledger.get_account_transactions` sign-by-normal-balance logic
 * (a Debit-normal account's balance rises with debits; a Credit-normal
 * account's rises with credits) — genuinely new is the monthly trend and
 * year comparison, since the reference never had a UI to chart this.
 */

import * as glRepo from "@/server/repositories/gl-repository";
import { getChartOfAccount } from "@/server/repositories/chart-of-accounts-repository";
import type { AccountActivity, GlTransaction, MonthlyActivityBucket } from "@/server/general-ledger/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure — unit tested. Buckets by calendar month (not financial period),
 * sorted ascending, so a chart can render it directly left-to-right. */
export function buildMonthlyTrend(transactions: Pick<GlTransaction, "postingDate" | "debit" | "credit">[]): MonthlyActivityBucket[] {
  const buckets = new Map<string, { debit: number; credit: number }>();
  for (const t of transactions) {
    const month = t.postingDate.slice(0, 7);
    const bucket = buckets.get(month) ?? { debit: 0, credit: 0 };
    bucket.debit = round2(bucket.debit + t.debit);
    bucket.credit = round2(bucket.credit + t.credit);
    buckets.set(month, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { debit, credit }]) => ({ month, debit, credit, netMovement: round2(debit - credit) }));
}

export async function getAccountActivity(companyId: string, accountId: number, dateFrom: string, dateTo: string): Promise<AccountActivity | null> {
  const account = await getChartOfAccount(companyId, accountId);
  if (!account) return null;

  const [before, transactions] = await Promise.all([
    glRepo.getAccountBalanceBefore(companyId, accountId, dateFrom),
    glRepo.getAccountTransactionsInRange(companyId, accountId, dateFrom, dateTo),
  ]);

  const openingBalance =
    account.normalBalance === "Debit" ? round2(before.totalDebit - before.totalCredit) : round2(before.totalCredit - before.totalDebit);
  const totalDebit = round2(transactions.reduce((sum, t) => sum + t.debit, 0));
  const totalCredit = round2(transactions.reduce((sum, t) => sum + t.credit, 0));
  const periodMovement = account.normalBalance === "Debit" ? totalDebit - totalCredit : totalCredit - totalDebit;
  const closingBalance = round2(openingBalance + periodMovement);

  return {
    account,
    dateFrom,
    dateTo,
    openingBalance,
    closingBalance,
    totalDebit,
    totalCredit,
    transactions,
    monthlyTrend: buildMonthlyTrend(transactions),
  };
}

/** One calendar year back from `dateStr`, clamping into the target month
 * when the day doesn't exist there (29 Feb in a leap year -> 28 Feb) —
 * same defensive clamping discipline as
 * `financial-year-service.ts::lastDayOfMonth`. */
export function shiftDateOneYearBack(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y - 1, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export type VarianceResult = { variance: number; variancePercent: number | null };

/** Pure — unit tested. `variancePercent` is `null` (not `Infinity`/`NaN`)
 * when there was no prior-year movement to compare against. */
export function computeVariance(currentTotal: number, previousTotal: number): VarianceResult {
  const variance = round2(currentTotal - previousTotal);
  const variancePercent = previousTotal !== 0 ? round2((variance / Math.abs(previousTotal)) * 100) : null;
  return { variance, variancePercent };
}

export type AccountYearComparison = { currentTotal: number; previousTotal: number; variance: number; variancePercent: number | null };

/** Same date range, one year earlier, for the same account — "previous
 * year" comparison. Returns `null` only when the account itself doesn't
 * exist; a period with zero prior-year activity still returns a real
 * comparison (previousTotal: 0). */
export async function getAccountYearComparison(companyId: string, accountId: number, dateFrom: string, dateTo: string): Promise<AccountYearComparison | null> {
  const previousDateFrom = shiftDateOneYearBack(dateFrom);
  const previousDateTo = shiftDateOneYearBack(dateTo);

  const [current, previous] = await Promise.all([
    getAccountActivity(companyId, accountId, dateFrom, dateTo),
    getAccountActivity(companyId, accountId, previousDateFrom, previousDateTo),
  ]);
  if (!current || !previous) return null;

  const currentTotal = round2(current.closingBalance - current.openingBalance);
  const previousTotal = round2(previous.closingBalance - previous.openingBalance);
  const { variance, variancePercent } = computeVariance(currentTotal, previousTotal);

  return { currentTotal, previousTotal, variance, variancePercent };
}
