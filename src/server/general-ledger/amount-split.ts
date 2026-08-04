/**
 * Pure gross/net/VAT splitting — extracted from `posting-rule-service.ts`
 * into its own file with NO imports (not even
 * `posting-rule-repository.ts`), so a purely-client-side consumer (e.g.
 * `vat-intelligence.ts`, used by a "use client" VAT Intelligence tab)
 * can depend on this arithmetic without its bundle pulling in
 * `posting-rule-service.ts`'s server-only siblings (`buildJournalFromEvent`
 * -> `posting-rule-repository.ts` -> `@/lib/supabase/server` ->
 * `next/headers`, which fails a client bundle build outright).
 * `posting-rule-service.ts` re-exports both names unchanged, so every
 * existing caller is unaffected — this is a file move, not a behavior
 * change.
 */

export type AmountSplit = { gross: number; net: number; vat: number };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure — given a VAT-inclusive amount and rate, the net/vat split every
 * rule line's `amountSource` picks from. Zero-rated/Exempt/No VAT
 * treatments (rate 0) collapse net === gross, vat === 0, which is exactly
 * correct rather than a special case. */
export function splitGrossAmount(grossAmount: number, vatRatePercent: number): AmountSplit {
  const gross = round2(grossAmount);
  const net = round2(gross / (1 + vatRatePercent / 100));
  const vat = round2(gross - net);
  return { gross, net, vat };
}
