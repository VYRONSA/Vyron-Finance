/**
 * Phase 28 — deterministic, explainable transaction-narration pattern
 * extraction. This is the ONE piece of new grouping intelligence this
 * phase adds: not a second AI engine, not fuzzy/uncontrolled matching —
 * a fixed, explicit vocabulary of known bank narration conventions
 * (confirmed against real production data, Northwood's own FNB business
 * account — see the Phase 28 forensic report) plus deterministic amount
 * bucketing, used ONLY to GROUP transactions for historical evidence
 * lookup (`company-historical-evidence.ts`).
 *
 * CRITICAL: this module never itself claims a prefix "means" a GL
 * account. The Phase 28 forensic investigation's central finding was
 * exactly that mistake — the AI reasoning "FNB OB Pmt... indicates a
 * payment to the bank" for dozens of transactions that were actually
 * individual wage/contractor payments. A prefix here is a grouping key,
 * nothing else; what it groups TOWARD is decided entirely by this
 * company's own real, human-confirmed history, never by the prefix text
 * itself. Extending `KNOWN_NARRATION_PREFIXES` is a safe, additive,
 * reviewable change — it only ever sharpens the grouping key, never
 * introduces new "meaning."
 */

import { isPayment, type BankTransactionRecord } from "@/server/accounting/types";

/** A fixed, explicit, ordered vocabulary of known transaction-type
 * narration prefixes — longest/most-specific first, so a more specific
 * prefix is never masked by a shorter one that happens to also match
 * (e.g. "FNB OB Trf" is listed even though it shares the "FNB OB"
 * stem with "FNB OB Pmt"/"FNB OB Coll" — each is its own distinct,
 * explicit entry, never inferred by truncation). */
const KNOWN_NARRATION_PREFIXES = [
  "FNB OB Pmt",
  "FNB OB Trf",
  "FNB OB Coll",
  "Magtape Debit",
  "Magtape Credit",
  "Overseas Bank Charge",
  "Outward Swift",
] as const;

/** Falls back to `"Other"` for anything not in the known vocabulary —
 * never guessed, never fuzzy-matched. A transaction with an
 * unrecognised prefix simply groups with every other unrecognised one,
 * which correctly yields weak/no pattern evidence for it rather than a
 * false grouping. */
export function extractNarrationPrefix(description: string): string {
  const trimmed = description.trim();
  for (const prefix of KNOWN_NARRATION_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return prefix;
  }
  return "Other";
}

/** Deterministic amount bands — fixed thresholds separating genuinely
 * fee-sized amounts (well under R500) from wage/contractor-sized
 * payments (thousands to tens of thousands) from large supplier/
 * capital-sized payments, based on the real distribution of production
 * transactions the Phase 28 investigation reviewed. Always the SAME
 * fixed bands for every company — never derived per-company or
 * per-transaction — so a pattern match always compares like with like. */
const AMOUNT_BANDS: { max: number; label: string }[] = [
  { max: 500, label: "0-500" },
  { max: 5000, label: "500-5000" },
  { max: 25000, label: "5000-25000" },
  { max: 100000, label: "25000-100000" },
  { max: Infinity, label: "100000+" },
];

export function amountBand(amount: number): string {
  return (AMOUNT_BANDS.find((b) => amount < b.max) ?? AMOUNT_BANDS[AMOUNT_BANDS.length - 1]!).label;
}

/** The inclusive-lower/exclusive-upper numeric bounds for a band label —
 * the exact SAME `AMOUNT_BANDS` table `amountBand` reads, exposed so a
 * repository query can filter for "everything in this band" without
 * restating the thresholds a second time. `max: null` means unbounded
 * (the top band). Returns `null` for an unrecognised label — callers
 * should treat that as "match nothing," never "match everything." */
export function amountBandBounds(label: string): { min: number; max: number | null } | null {
  const index = AMOUNT_BANDS.findIndex((b) => b.label === label);
  if (index === -1) return null;
  const min = index === 0 ? 0 : AMOUNT_BANDS[index - 1]!.max;
  const max = AMOUNT_BANDS[index]!.max;
  return { min, max: Number.isFinite(max) ? max : null };
}

export type TransactionNarrationPattern = {
  prefix: string;
  amountBand: string;
  direction: "Debit" | "Credit";
};

/** Prefers `beneficiary` over `description` (in this codebase's actual
 * data, the two are usually identical — see the Phase 28 forensic
 * report's live query results — but `beneficiary` is the more
 * consistently-populated field across import formats), falling back to
 * `description` only when `beneficiary` is empty. */
export function derivePattern(transaction: Pick<BankTransactionRecord, "description" | "beneficiary" | "debit" | "credit">): TransactionNarrationPattern {
  const direction: "Debit" | "Credit" = isPayment(transaction) ? "Debit" : "Credit";
  const amount = direction === "Debit" ? transaction.debit : transaction.credit;
  const source = transaction.beneficiary || transaction.description;
  return { prefix: extractNarrationPrefix(source), amountBand: amountBand(amount), direction };
}

/** A single string form of a pattern, for use as a Map key or a SQL
 * `ilike` prefix filter value — always derived from `derivePattern`'s
 * own fields, never constructed independently, so the two can never
 * silently drift apart. */
export function patternKey(pattern: TransactionNarrationPattern): string {
  return `${pattern.prefix}|${pattern.amountBand}|${pattern.direction}`;
}
