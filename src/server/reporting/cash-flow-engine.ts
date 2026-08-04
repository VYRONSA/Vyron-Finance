/**
 * Pure Cash Flow Statement engine (indirect method) — no Supabase.
 * Reuses `computePeriodMovements` from `income-statement-engine.ts`
 * rather than a third GL-diffing implementation.
 *
 * The indirect method here is provably exact, not approximate: because
 * every journal in this platform is balanced by construction (the one
 * Posting Engine rejects anything that isn't), the sum of every
 * account's period credit-minus-debit movement across the WHOLE ledger
 * is always zero. That means `Net Profit + the full working-capital
 * movement of every non-cash Balance Sheet account` is mathematically
 * guaranteed to equal the direct period movement of the cash/bank
 * accounts themselves — so `reconciliationVariance` below should always
 * be 0.00; a non-zero value is a real signal (an unbalanced posting
 * slipped through), not statement-building noise.
 *
 * Disclosed simplification (no Fixed Assets/Loans modules exist yet):
 * every non-cash Asset AND every Liability movement is folded into
 * Operating Activities (the indirect method's standard treatment of
 * working capital); Investing Activities has nothing to populate until
 * a Fixed Assets module exists to distinguish capital purchases from
 * operating expenses, and is shown as an explicit empty section rather
 * than silently omitted. Financing Activities captures real Equity
 * account movements (e.g. capital contributions/drawings journaled
 * directly) — never the synthetic "Current Year Earnings" line the
 * Balance Sheet engine adds, which corresponds to no real transaction.
 */

import type { ChartOfAccount, TrialBalanceRow } from "@/server/general-ledger/types";
import { computePeriodMovements, type StatementLine, type StatementSection } from "./income-statement-engine";

export type CashFlowStatement = {
  periodStart: string;
  periodEnd: string;
  operatingActivities: StatementSection;
  investingActivities: StatementSection;
  financingActivities: StatementSection;
  netChangeInCash: number;
  actualCashMovement: number;
  reconciliationVariance: number;
  openingCash: number;
  closingCash: number;
};

const RECONCILIATION_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure. `cashAccountIds` — the accounts treated as cash/cash-equivalents
 * (Bank accounts) — is supplied by the caller rather than guessed inside
 * this engine (see `financial-statements-service.ts` for how it's
 * derived; this keeps the engine itself free of any account-naming
 * heuristic). `openingCash`/`closingCash` come from the same two Trial
 * Balance snapshots the Income Statement used for this period. */
export function buildCashFlowStatement(
  accounts: ChartOfAccount[],
  startRows: TrialBalanceRow[],
  endRows: TrialBalanceRow[],
  periodStart: string,
  periodEnd: string,
  netProfitForPeriod: number,
  cashAccountIds: number[],
): CashFlowStatement {
  const movements = computePeriodMovements(accounts, startRows, endRows);
  const cashIds = new Set(cashAccountIds);

  const operatingLines: StatementLine[] = [
    { accountId: -1, accountCode: "", description: "Net Profit for the Period", reportingGroup: "Operating", amount: round2(netProfitForPeriod) },
  ];
  const financingLines: StatementLine[] = [];
  let actualCashMovement = 0;

  for (const { periodDebit, periodCredit, account } of movements.values()) {
    const netMovement = round2(periodCredit - periodDebit); // "X" — see module docstring
    if (netMovement === 0) continue;

    if (cashIds.has(account.id)) {
      actualCashMovement = round2(actualCashMovement + (periodDebit - periodCredit));
      continue;
    }

    if (account.accountType === "Asset" || account.accountType === "Liability") {
      operatingLines.push({ accountId: account.id, accountCode: account.accountCode, description: `Change in ${account.description}`, reportingGroup: account.reportingGroup, amount: netMovement });
    } else if (account.accountType === "Equity") {
      financingLines.push({ accountId: account.id, accountCode: account.accountCode, description: account.description, reportingGroup: account.reportingGroup, amount: netMovement });
    }
  }

  operatingLines.sort((a, b) => (a.accountCode || "").localeCompare(b.accountCode || ""));
  financingLines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const operatingActivities: StatementSection = { label: "Operating Activities", lines: operatingLines, total: round2(operatingLines.reduce((s, l) => s + l.amount, 0)) };
  const investingActivities: StatementSection = { label: "Investing Activities", lines: [], total: 0 };
  const financingActivities: StatementSection = { label: "Financing Activities", lines: financingLines, total: round2(financingLines.reduce((s, l) => s + l.amount, 0)) };

  const netChangeInCash = round2(operatingActivities.total + investingActivities.total + financingActivities.total);
  const reconciliationVarianceRaw = round2(netChangeInCash - actualCashMovement);
  const reconciliationVariance = Math.abs(reconciliationVarianceRaw) <= RECONCILIATION_TOLERANCE ? 0 : reconciliationVarianceRaw;

  const openingCashRows = new Map(startRows.map((r) => [r.accountId, r]));
  const closingCashRows = new Map(endRows.map((r) => [r.accountId, r]));
  const openingCash = round2(cashAccountIds.reduce((sum, id) => sum + (openingCashRows.get(id)?.debitBalance ?? 0) - (openingCashRows.get(id)?.creditBalance ?? 0), 0));
  const closingCash = round2(cashAccountIds.reduce((sum, id) => sum + (closingCashRows.get(id)?.debitBalance ?? 0) - (closingCashRows.get(id)?.creditBalance ?? 0), 0));

  return { periodStart, periodEnd, operatingActivities, investingActivities, financingActivities, netChangeInCash, actualCashMovement, reconciliationVariance, openingCash, closingCash };
}
