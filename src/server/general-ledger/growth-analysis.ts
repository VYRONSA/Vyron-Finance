/**
 * Pure period-over-period account growth analysis — extracted from
 * `financial-intelligence-service.ts` into its own zero-import file for
 * the exact same reason `amount-split.ts` exists (see that file's own
 * docstring): a "pure" function sharing a file with server-only Supabase
 * repository imports is NOT safely importable from a Client Component,
 * even via a named import, because ES modules bundle at the file level.
 * `audit-assistant-engine.ts` needs `findUnusualGrowth` and is reachable
 * from a Client Component (`audit-assistant-tab.tsx`), which is what
 * surfaced this. `financial-intelligence-service.ts` re-exports both
 * names unchanged so every existing caller is unaffected.
 */

import type { GlTransactionWithContext } from "@/server/general-ledger/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type AccountMovement = { accountCode: string; accountDescription: string; movement: number };

/** Pure — net signed movement (debit - credit) per account across a set
 * of postings, independent of `normalBalance` (both periods use the same
 * convention, so the comparison in `findUnusualGrowth` stays correct
 * either way). */
export function aggregateMovementsByAccount(transactions: GlTransactionWithContext[]): Map<number, AccountMovement> {
  const map = new Map<number, AccountMovement>();
  for (const t of transactions) {
    const existing = map.get(t.accountId) ?? { accountCode: t.accountCode, accountDescription: t.accountDescription, movement: 0 };
    existing.movement = round2(existing.movement + t.debit - t.credit);
    map.set(t.accountId, existing);
  }
  return map;
}

export type UnusualGrowthAlert = {
  accountId: number;
  accountCode: string;
  accountDescription: string;
  currentMovement: number;
  previousMovement: number;
  changePercent: number | null;
  reasoning: string;
};

/** Pure — flags accounts whose period-over-period movement changed by at
 * least `thresholdPercent`. An account with zero prior-period movement
 * (no baseline to compare against) is still flagged if it moved at all
 * this period, with `changePercent: null` rather than a divide-by-zero
 * artifact. */
export function findUnusualGrowth(
  currentByAccount: Map<number, AccountMovement>,
  previousByAccount: Map<number, AccountMovement>,
  thresholdPercent: number,
): UnusualGrowthAlert[] {
  const alerts: UnusualGrowthAlert[] = [];

  for (const [accountId, current] of currentByAccount) {
    const previousMovement = previousByAccount.get(accountId)?.movement ?? 0;

    if (previousMovement === 0) {
      if (current.movement === 0) continue;
      alerts.push({
        accountId,
        accountCode: current.accountCode,
        accountDescription: current.accountDescription,
        currentMovement: current.movement,
        previousMovement: 0,
        changePercent: null,
        reasoning: `${current.accountCode} had no movement in the prior period but moved ${current.movement} in this one.`,
      });
      continue;
    }

    const changePercent = round2(((current.movement - previousMovement) / Math.abs(previousMovement)) * 100);
    if (Math.abs(changePercent) >= thresholdPercent) {
      alerts.push({
        accountId,
        accountCode: current.accountCode,
        accountDescription: current.accountDescription,
        currentMovement: current.movement,
        previousMovement,
        changePercent,
        reasoning: `${current.accountCode} moved ${changePercent > 0 ? "up" : "down"} ${Math.abs(changePercent)}% vs the prior period (${previousMovement} -> ${current.movement}).`,
      });
    }
  }

  return alerts.sort((a, b) => Math.abs(b.changePercent ?? Number.POSITIVE_INFINITY) - Math.abs(a.changePercent ?? Number.POSITIVE_INFINITY));
}

const MS_PER_DAY = 86_400_000;

/** Pure — the immediately preceding period of equal length, so "period-
 * over-period" compares two adjacent windows (last 30 days vs. the 30
 * before that), distinct from Account Activity's "same dates, one year
 * back" comparison. */
export function shiftPeriodBack(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const fromMs = Date.parse(`${dateFrom}T00:00:00Z`);
  const toMs = Date.parse(`${dateTo}T00:00:00Z`);
  const lengthMs = toMs - fromMs;
  const previousToMs = fromMs - MS_PER_DAY;
  const previousFromMs = previousToMs - lengthMs;
  return {
    dateFrom: new Date(previousFromMs).toISOString().slice(0, 10),
    dateTo: new Date(previousToMs).toISOString().slice(0, 10),
  };
}
