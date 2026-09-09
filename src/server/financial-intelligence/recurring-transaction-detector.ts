/**
 * Recurring Transaction & Commitment Detection — Phase 25B. Pure,
 * deterministic, no AI: groups a company's own bank transaction history by
 * (direction, beneficiary identity) — reusing `normalizedBeneficiary` from
 * `banking-rules/banking-intelligence.ts` rather than a second
 * normalization algorithm — then clusters each group by amount similarity
 * and checks whether the resulting dates fall into one of four fixed,
 * documented periodicity windows. Nothing here is persisted; like every
 * other Financial Intelligence input, it's recomputed fresh per request
 * from real transaction history.
 *
 * Complexity: transactions are bucketed by (direction, beneficiary) in one
 * O(n) pass, then each bucket (typically small relative to a company's
 * total transaction count) is sorted and walked once — O(n log n) overall,
 * never a full O(n^2) transaction-against-transaction comparison.
 */

import { normalizedBeneficiary, type IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";

export type RecurringTransactionPeriodicity = "Weekly" | "Fortnightly" | "Monthly" | "Quarterly";

export type RecurringTransactionPattern = {
  beneficiary: string;
  direction: "Debit" | "Credit";
  periodicity: RecurringTransactionPeriodicity;
  typicalAmount: number;
  occurrenceCount: number;
  firstDate: string;
  latestDate: string;
  transactionIds: number[];
};

/** Same "3 strikes" convention this codebase already uses elsewhere for
 * "is this a real pattern, not a coincidence" (Transaction Explorer's own
 * `REPEATED_ALLOCATION_THRESHOLD`, the trigger for prompting "create a
 * rule?"). Two transactions can share a beneficiary, amount, and even a
 * plausible gap purely by chance; a third occurrence at a consistent
 * interval is the minimum evidence this codebase already treats as
 * meaningful. */
const MIN_EVIDENCE = 3;

/** Amount-similarity tolerance for treating same-beneficiary payments as
 * "the same recurring commitment" despite small drift (e.g. an annual rent
 * escalation, a subscription price bump) — 15% of the cluster's running
 * median. Chosen to comfortably cover the brief's own example
 * (R1,000 / R1,020 / R1,000 — ~2% variation) while still rejecting amounts
 * that differ by an order of magnitude, which must never group merely
 * because the beneficiary matches. */
const AMOUNT_TOLERANCE_FRACTION = 0.15;

/** Deterministic day-gap windows for each periodicity label. Real-world
 * recurring payments never land on an exact calendar interval (weekends,
 * bank processing days, month lengths), so each window is a tolerance band
 * around the nominal interval, not an exact match. Monthly's 25–35 day
 * band is wide enough to absorb a weekend/holiday shift without
 * overlapping Fortnightly's 11–17 day band. */
const PERIODICITY_WINDOWS: { label: RecurringTransactionPeriodicity; minDays: number; maxDays: number }[] = [
  { label: "Weekly", minDays: 5, maxDays: 9 },
  { label: "Fortnightly", minDays: 11, maxDays: 17 },
  { label: "Monthly", minDays: 25, maxDays: 35 },
  { label: "Quarterly", minDays: 80, maxDays: 100 },
];

function directionOf(t: IntelligenceTransaction): "Debit" | "Credit" | null {
  if (t.debit > 0) return "Debit";
  if (t.credit > 0) return "Credit";
  return null;
}

function amountOf(t: IntelligenceTransaction, direction: "Debit" | "Credit"): number {
  return direction === "Debit" ? t.debit : t.credit;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Greedy single pass over amounts sorted ascending: a transaction joins
 * the current cluster when it's within tolerance of that cluster's running
 * median, otherwise it starts a new cluster. Deterministic (fixed sort
 * order, no randomness) and never revisits an earlier decision. */
function clusterByAmount(group: IntelligenceTransaction[], direction: "Debit" | "Credit"): IntelligenceTransaction[][] {
  const byAmount = [...group].sort((a, b) => amountOf(a, direction) - amountOf(b, direction));
  const clusters: IntelligenceTransaction[][] = [];
  let current: IntelligenceTransaction[] = [];

  for (const t of byAmount) {
    if (current.length === 0) {
      current.push(t);
      continue;
    }
    const currentMedian = median(current.map((c) => amountOf(c, direction)));
    const withinTolerance = Math.abs(amountOf(t, direction) - currentMedian) <= currentMedian * AMOUNT_TOLERANCE_FRACTION;
    if (withinTolerance) {
      current.push(t);
    } else {
      clusters.push(current);
      current = [t];
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/** A pattern is only recorded when EVERY consecutive gap between
 * chronologically sorted occurrences falls in the same periodicity's
 * window — the most conservative rule available, deliberately rejecting
 * irregular date sequences rather than accepting a "mostly regular"
 * majority. */
function classifyPeriodicity(sortedByDate: IntelligenceTransaction[]): RecurringTransactionPeriodicity | null {
  const gaps: number[] = [];
  for (let i = 1; i < sortedByDate.length; i++) {
    gaps.push((Date.parse(sortedByDate[i]!.transactionDate!) - Date.parse(sortedByDate[i - 1]!.transactionDate!)) / 86_400_000);
  }
  if (gaps.length === 0) return null;

  for (const window of PERIODICITY_WINDOWS) {
    if (gaps.every((g) => g >= window.minDays && g <= window.maxDays)) return window.label;
  }
  return null;
}

/** Pure. Reads only `id`/`transactionDate`/`beneficiary`/`debit`/`credit`
 * — the same minimal shape `banking-intelligence.ts`'s own detectors
 * already use — so a caller can pass real `BankTransactionRecord[]`
 * (structurally compatible) without a conversion step. Transactions with
 * no `transactionDate`, or with neither a debit nor a credit amount, are
 * silently excluded (never treated as evidence either way). */
export function detectRecurringTransactionPatterns(transactions: IntelligenceTransaction[]): RecurringTransactionPattern[] {
  const groups = new Map<string, { direction: "Debit" | "Credit"; items: IntelligenceTransaction[] }>();

  for (const t of transactions) {
    if (t.transactionDate === null) continue;
    const direction = directionOf(t);
    if (!direction) continue;

    const key = `${direction}|${normalizedBeneficiary(t.beneficiary)}`;
    const group = groups.get(key) ?? { direction, items: [] };
    group.items.push(t);
    groups.set(key, group);
  }

  const patterns: RecurringTransactionPattern[] = [];

  for (const { direction, items } of groups.values()) {
    if (items.length < MIN_EVIDENCE) continue;

    for (const cluster of clusterByAmount(items, direction)) {
      if (cluster.length < MIN_EVIDENCE) continue;

      const byDate = [...cluster].sort((a, b) => Date.parse(a.transactionDate!) - Date.parse(b.transactionDate!));
      const periodicity = classifyPeriodicity(byDate);
      if (periodicity === null) continue;

      patterns.push({
        beneficiary: byDate[byDate.length - 1]!.beneficiary,
        direction,
        periodicity,
        typicalAmount: median(byDate.map((t) => amountOf(t, direction))),
        occurrenceCount: byDate.length,
        firstDate: byDate[0]!.transactionDate!,
        latestDate: byDate[byDate.length - 1]!.transactionDate!,
        transactionIds: byDate.map((t) => t.id),
      });
    }
  }

  return patterns.sort((a, b) => (a.latestDate < b.latestDate ? 1 : a.latestDate > b.latestDate ? -1 : 0));
}
