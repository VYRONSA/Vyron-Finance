/**
 * The platform's ONE VAT Engine — pure, no Supabase, exhaustively unit
 * tested. Deliberately does NOT reimplement gross/net/vat splitting:
 * `splitVat` below is a thin wrapper around the exact same
 * `splitGrossAmount` every Sales/Purchasing/Inventory approve-and-post
 * path already calls (`posting-rule-service.ts`) — confirmed by research
 * to be the codebase's one, real, already-centralized VAT math primitive.
 * What's new here: resolving which RATE actually applied on a given
 * date (effective-dated history, not a bare mutable column), and the
 * VAT Return settlement journal — a genuinely bespoke line-builder (its
 * two amounts are independent period-end GL account balances, not a
 * single gross-amount three-way split, so it can't be expressed as a
 * `posting_rules` event), but one that still terminates at the same
 * `postApprovedJournals` Posting Engine every other document type uses,
 * same precedent as `journal-service.ts::buildJournalLinesForTransaction`
 * being its own bespoke-but-real line builder alongside the generic
 * Posting Rules engine.
 */

import { splitGrossAmount, type AmountSplit } from "@/server/general-ledger/amount-split";
import type { NewJournalLine } from "@/server/repositories/journal-repository";
import type { VatRateHistoryEntry, VatType } from "./types";

export type { AmountSplit };

/** Pure — the one place "what rate applied on date X" is decided. A
 * treatment with no history covering the date falls back to the most
 * recent entry at or before it (a rate change takes effect from its
 * `effective_from` date forward, never retroactively). Returns null only
 * when there is truly no history at all (a data problem, not a normal
 * case — every treatment gets a seeded history row on creation). */
export function resolveEffectiveRate(history: VatRateHistoryEntry[], asOfDate: string): number | null {
  const covering = history.find((h) => h.effectiveFrom <= asOfDate && (h.effectiveTo === null || asOfDate <= h.effectiveTo));
  if (covering) return covering.rate;

  const priorEntries = history.filter((h) => h.effectiveFrom <= asOfDate).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  if (priorEntries.length > 0) return priorEntries[0].rate;

  return null;
}

/** Thin wrapper — genuine reuse, not a second implementation. */
export function splitVat(grossAmount: number, ratePercent: number): AmountSplit {
  return splitGrossAmount(grossAmount, ratePercent);
}

/** Pure — whether a treatment's VAT type is internally consistent with a
 * computed split. A `ZeroRated`/`Exempt`/`OutsideScope` treatment should
 * never produce a non-zero VAT component; a `Standard`/`Import` treatment
 * on a non-zero gross amount should never produce a zero VAT component.
 * The one place "incorrect VAT code" detection's arithmetic check lives —
 * `vat-intelligence.ts` calls this rather than re-deriving the rule. */
export function isVatSplitConsistentWithType(vatType: VatType, split: AmountSplit): boolean {
  const noVatTypes: VatType[] = ["ZeroRated", "Exempt", "OutsideScope"];
  if (noVatTypes.includes(vatType)) return split.vat === 0;
  if (split.gross === 0) return true; // nothing to check on a zero-value document
  return split.vat > 0;
}

/** Pure — the VAT Return settlement journal: clears the period's
 * accumulated VAT Input (2100) and VAT Output (2200) balances and plugs
 * the difference to VAT Control (2300) as a real payable (credit) or
 * receivable (debit) position. Not expressible as a standard
 * `posting_rules` event (its two amounts are independent GL account
 * balances, not one gross-amount split) — see this file's module
 * docstring. Balanced by construction; still returns `ok:false` if the
 * inputs are already zero (nothing to settle). */
export type SettlementJournalResult = { ok: true; lines: NewJournalLine[] } | { ok: false; reason: string };

export function buildVatSettlementJournalLines(outputVatBalance: number, inputVatBalance: number, description: string): SettlementJournalResult {
  const output = Math.round(outputVatBalance * 100) / 100;
  const input = Math.round(inputVatBalance * 100) / 100;

  if (output === 0 && input === 0) {
    return { ok: false, reason: "Both VAT Input and VAT Output balances are zero — nothing to settle." };
  }

  const netPayable = Math.round((output - input) * 100) / 100;
  const lines: NewJournalLine[] = [];

  if (output > 0) lines.push({ accountCode: "2200", debit: output, credit: 0, description });
  else if (output < 0) lines.push({ accountCode: "2200", debit: 0, credit: -output, description });

  if (input > 0) lines.push({ accountCode: "2100", debit: 0, credit: input, description });
  else if (input < 0) lines.push({ accountCode: "2100", debit: -input, credit: 0, description });

  if (netPayable > 0) lines.push({ accountCode: "2300", debit: 0, credit: netPayable, description });
  else if (netPayable < 0) lines.push({ accountCode: "2300", debit: -netPayable, credit: 0, description });

  return { ok: true, lines };
}
