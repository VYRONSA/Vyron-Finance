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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type JournalLinesResult = { ok: true; lines: NewJournalLine[] } | { ok: false; reason: string };

/** Pure — one consolidated journal for an entire Depreciation Run
 * (DR Depreciation Expense, CR Accumulated Depreciation), rather than
 * one journal per asset — real accounting practice, and the same
 * "bespoke-but-real, still one journal, still balanced by construction"
 * precedent as `buildVatSettlementJournalLines`. */
export function buildDepreciationRunJournalLines(totalDepreciation: number, description: string): JournalLinesResult {
  const amount = round2(totalDepreciation);
  if (amount <= 0) return { ok: false, reason: "Total depreciation for this run is zero — nothing to post." };

  return {
    ok: true,
    lines: [
      { accountCode: "6500", debit: amount, credit: 0, description },
      { accountCode: "1650", debit: 0, credit: amount, description },
    ],
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
export function buildAssetDisposalJournalLines(
  cost: number,
  accumulatedDepreciation: number,
  accumulatedImpairment: number,
  proceeds: number,
  paymentAccountCode: string | null,
  description: string,
): JournalLinesResult {
  if (cost <= 0) return { ok: false, reason: "Asset has no cost recorded — nothing to disposal-post." };

  const lines: NewJournalLine[] = [];
  lines.push({ accountCode: "1600", debit: 0, credit: round2(cost), description });
  if (accumulatedDepreciation > 0) lines.push({ accountCode: "1650", debit: round2(accumulatedDepreciation), credit: 0, description });
  if (accumulatedImpairment > 0) lines.push({ accountCode: "1660", debit: round2(accumulatedImpairment), credit: 0, description });

  if (proceeds > 0) {
    if (!paymentAccountCode) return { ok: false, reason: "Proceeds were received but no payment account was supplied." };
    lines.push({ accountCode: paymentAccountCode, debit: round2(proceeds), credit: 0, description });
  }

  const { amount, isGain } = computeDisposalGainOrLoss(cost, accumulatedDepreciation, accumulatedImpairment, proceeds);
  if (amount > 0) {
    lines.push(isGain ? { accountCode: "6250", debit: 0, credit: amount, description } : { accountCode: "6600", debit: amount, credit: 0, description });
  }

  return { ok: true, lines };
}
