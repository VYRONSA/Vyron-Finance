/**
 * Application Service layer for the Trial Balance — live/instant, nothing
 * cached, matching the reference's own "nothing to rebuild, just call
 * again" philosophy for `trial_balance.py`. Row computation itself lives
 * DB-side (`fn_trial_balance`, see 0007_general_ledger.sql); this layer's
 * job is the one thing worth testing without Supabase: that debit and
 * credit totals actually balance.
 */

import * as repo from "@/server/repositories/gl-repository";
import type { TrialBalance, TrialBalanceRow } from "@/server/general-ledger/types";

const BALANCE_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type TrialBalanceSummary = { totalDebit: number; totalCredit: number; isBalanced: boolean };

/** Pure — unit tested. Every real posting is double-entry-balanced by
 * construction (the Posting Engine rejects anything that isn't), so
 * `isBalanced: false` here would mean ledger corruption, not a normal
 * outcome — worth surfacing loudly rather than silently trusting the
 * totals. */
export function summarizeTrialBalance(rows: TrialBalanceRow[]): TrialBalanceSummary {
  const totalDebit = round2(rows.reduce((sum, r) => sum + r.debitBalance, 0));
  const totalCredit = round2(rows.reduce((sum, r) => sum + r.creditBalance, 0));
  return { totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) <= BALANCE_TOLERANCE };
}

export async function getTrialBalance(companyId: string, asOfDate: string | null = null): Promise<TrialBalance> {
  const rows = await repo.getTrialBalanceRows(companyId, asOfDate);
  const { totalDebit, totalCredit } = summarizeTrialBalance(rows);
  return { asOfDate, rows, totalDebit, totalCredit };
}
