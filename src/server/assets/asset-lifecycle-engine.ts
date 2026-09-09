/**
 * Pure journal-line builders for the two Asset Lifecycle events too
 * structurally different for the standard one-gross-amount
 * `buildJournalFromEvent`/`posting_rules` path — same precedent as
 * `vat-engine.ts::buildVatSettlementJournalLines`. Acquisition/
 * Improvement/Revaluation Increase/Impairment are all plain two-line
 * gross-amount events and go through the real seeded `posting_rules`
 * rows instead (see `asset-lifecycle-service.ts`) — nothing here
 * duplicates those. Both builders here still terminate at the same
 * shared `postApprovedJournals` Posting Engine every other document
 * type uses.
 */

import type { NewJournalLine } from "@/server/repositories/journal-repository";
import type { AssetClass } from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Finding #050 — the platform-wide fallback every asset posted to before
// Asset Classes had any GL account columns. A class whose own account is
// null (unset) still resolves here, so existing behaviour is unchanged
// for every asset until a class is explicitly given its own accounts.
export const DEFAULT_ASSET_ACCOUNT_CODE = "1600";
export const DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE = "1650";
export const DEFAULT_ACCUMULATED_IMPAIRMENT_ACCOUNT_CODE = "1660";
export const DEFAULT_DEPRECIATION_EXPENSE_ACCOUNT_CODE = "6500";
export const DEFAULT_GAIN_ON_DISPOSAL_ACCOUNT_CODE = "6250";
export const DEFAULT_LOSS_ON_DISPOSAL_ACCOUNT_CODE = "6600";

export type JournalLinesResult = { ok: true; lines: NewJournalLine[] } | { ok: false; reason: string };

export type ClassDepreciationAmount = {
  depreciationExpenseAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  amount: number;
};

/** Pure — one consolidated journal for an entire Depreciation Run, but
 * grouped by each asset's OWN (possibly class-overridden) expense/
 * accumulated-depreciation account pair rather than one hardcoded pair
 * for every asset (Finding #050) — still real accounting practice (one
 * journal, not one per asset), same "bespoke-but-real, still balanced by
 * construction" precedent as `buildVatSettlementJournalLines`. Entries
 * sharing the same account pair (the common case — most/all classes use
 * the platform default) collapse into one DR/CR line pair, not one per
 * class, so the journal stays as compact as before whenever no class has
 * actually customized its accounts. */
export function buildDepreciationRunJournalLines(amounts: ClassDepreciationAmount[], description: string): JournalLinesResult {
  const positive = amounts.filter((a) => a.amount > 0);
  const totalAmount = round2(positive.reduce((sum, a) => sum + a.amount, 0));
  if (totalAmount <= 0) return { ok: false, reason: "Total depreciation for this run is zero — nothing to post." };

  const byAccountPair = new Map<string, { depreciationExpenseAccountCode: string; accumulatedDepreciationAccountCode: string; amount: number }>();
  for (const a of positive) {
    const key = `${a.depreciationExpenseAccountCode}|${a.accumulatedDepreciationAccountCode}`;
    const entry = byAccountPair.get(key) ?? { depreciationExpenseAccountCode: a.depreciationExpenseAccountCode, accumulatedDepreciationAccountCode: a.accumulatedDepreciationAccountCode, amount: 0 };
    entry.amount = round2(entry.amount + a.amount);
    byAccountPair.set(key, entry);
  }

  const lines: NewJournalLine[] = [];
  for (const { depreciationExpenseAccountCode, accumulatedDepreciationAccountCode, amount } of byAccountPair.values()) {
    lines.push({ accountCode: depreciationExpenseAccountCode, debit: amount, credit: 0, description });
    lines.push({ accountCode: accumulatedDepreciationAccountCode, debit: 0, credit: amount, description });
  }

  return { ok: true, lines };
}

export type AssetClassAccountCodes = DisposalAccountCodes & { depreciationExpenseAccountCode: string };

/** Pure — Finding #050's one resolution point: an asset with no class
 * (`assetClass: null`), or a class that hasn't overridden a given
 * account, falls back to the platform default; a class that HAS set an
 * account uses it. */
export function resolveAssetClassAccounts(assetClass: AssetClass | null): AssetClassAccountCodes {
  return {
    assetAccountCode: assetClass?.glAssetAccountCode ?? DEFAULT_ASSET_ACCOUNT_CODE,
    accumulatedDepreciationAccountCode: assetClass?.glAccumulatedDepreciationAccountCode ?? DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE,
    accumulatedImpairmentAccountCode: assetClass?.glAccumulatedImpairmentAccountCode ?? DEFAULT_ACCUMULATED_IMPAIRMENT_ACCOUNT_CODE,
    depreciationExpenseAccountCode: assetClass?.glDepreciationExpenseAccountCode ?? DEFAULT_DEPRECIATION_EXPENSE_ACCOUNT_CODE,
    gainOnDisposalAccountCode: assetClass?.glGainOnDisposalAccountCode ?? DEFAULT_GAIN_ON_DISPOSAL_ACCOUNT_CODE,
    lossOnDisposalAccountCode: assetClass?.glLossOnDisposalAccountCode ?? DEFAULT_LOSS_ON_DISPOSAL_ACCOUNT_CODE,
  };
}

export type DisposalGainOrLoss = { amount: number; isGain: boolean };

/** Pure — the disposal gain/loss an auditor would recompute independently:
 * proceeds received minus the asset's net book value at disposal. A
 * positive result is a gain (proceeds exceeded NBV), negative is a loss. */
export function computeDisposalGainOrLoss(cost: number, accumulatedDepreciation: number, accumulatedImpairment: number, proceeds: number): DisposalGainOrLoss {
  const netBookValue = round2(cost - accumulatedDepreciation - accumulatedImpairment);
  const delta = round2(proceeds - netBookValue);
  return { amount: Math.abs(delta), isGain: delta >= 0 };
}

/** Pure — clears an asset's Cost, Accumulated Depreciation, and
 * Accumulated Impairment balances off the books, recognizes any
 * proceeds received, and plugs the resulting gain or loss. Balanced by
 * construction — worked through for both cases:
 *
 * Let NBV = cost - accDep - accImp.
 * Gain case (proceeds >= NBV), gain = proceeds - NBV:
 *   credits = cost + gain = cost + proceeds - NBV = proceeds + accDep + accImp
 *   debits  = accDep + accImp + proceeds  ->  equal.
 * Loss case (proceeds < NBV), loss = NBV - proceeds:
 *   debits  = accDep + accImp + proceeds + loss = accDep + accImp + NBV = cost
 *   credits = cost  ->  equal.
 *
 * Write-off/Retirement reuse this same function with `proceeds = 0` —
 * a write-off is simply a disposal with nothing received for it. */
export type DisposalAccountCodes = {
  assetAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  accumulatedImpairmentAccountCode: string;
  gainOnDisposalAccountCode: string;
  lossOnDisposalAccountCode: string;
};

/** Finding #050 — every account below used to be hardcoded regardless of
 * the asset's class; `accountCodes` now carries each asset's OWN
 * (possibly class-overridden) accounts, resolved by the caller against
 * the `DEFAULT_*_ACCOUNT_CODE` constants above. */
export function buildAssetDisposalJournalLines(
  cost: number,
  accumulatedDepreciation: number,
  accumulatedImpairment: number,
  proceeds: number,
  paymentAccountCode: string | null,
  accountCodes: DisposalAccountCodes,
  description: string,
): JournalLinesResult {
  if (cost <= 0) return { ok: false, reason: "Asset has no cost recorded — nothing to disposal-post." };

  const lines: NewJournalLine[] = [];
  lines.push({ accountCode: accountCodes.assetAccountCode, debit: 0, credit: round2(cost), description });
  if (accumulatedDepreciation > 0) lines.push({ accountCode: accountCodes.accumulatedDepreciationAccountCode, debit: round2(accumulatedDepreciation), credit: 0, description });
  if (accumulatedImpairment > 0) lines.push({ accountCode: accountCodes.accumulatedImpairmentAccountCode, debit: round2(accumulatedImpairment), credit: 0, description });

  if (proceeds > 0) {
    if (!paymentAccountCode) return { ok: false, reason: "Proceeds were received but no payment account was supplied." };
    lines.push({ accountCode: paymentAccountCode, debit: round2(proceeds), credit: 0, description });
  }

  const { amount, isGain } = computeDisposalGainOrLoss(cost, accumulatedDepreciation, accumulatedImpairment, proceeds);
  if (amount > 0) {
    lines.push(
      isGain
        ? { accountCode: accountCodes.gainOnDisposalAccountCode, debit: 0, credit: amount, description }
        : { accountCode: accountCodes.lossOnDisposalAccountCode, debit: amount, credit: 0, description },
    );
  }

  return { ok: true, lines };
}
