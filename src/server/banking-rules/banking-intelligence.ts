/**
 * Banking Intelligence — pure, deterministic, computed-from-data signals
 * only (same honest framing as `inventory-intelligence-service.ts` and
 * the Transaction Explorer Recovery Panel: no "AI"/"ML" claim beyond
 * what is literally computed and shown with its own reasoning string).
 * "Potential fraud" per the Product Review Board's brief is deliberately
 * NOT asserted as a fact anywhere here — it surfaces as a
 * "suspicious-pattern" heuristic risk flag with an explicit confidence
 * and reasoning, exactly like every other signal, never a bare label.
 */

export type IntelligenceTransaction = {
  id: number;
  transactionDate: string | null;
  beneficiary: string;
  debit: number;
  credit: number;
};

export type BankingIntelligenceSignal = {
  kind: "duplicate-payment" | "new-merchant" | "unusual-spending" | "suspicious-pattern" | "cash-flow-impact";
  message: string;
  reasoning: string;
  confidence: number;
  suggestedAction: string;
};

function amount(t: IntelligenceTransaction): number {
  return t.debit > 0 ? t.debit : t.credit;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function normalizedBeneficiary(name: string): string {
  return name.trim().toLowerCase();
}

/** Same-beneficiary, same-amount, same-direction payments within
 * `windowDays` of each other — a transaction-level counterpart to the
 * Matching Engine's own bill-duplicate detection, but comparing raw bank
 * transactions to each other rather than payments to bills. */
export function detectDuplicatePayments(transactions: IntelligenceTransaction[], windowDays = 3): Map<number, BankingIntelligenceSignal> {
  const signals = new Map<number, BankingIntelligenceSignal>();
  const dated = transactions.filter((t) => t.transactionDate !== null);

  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      if (a.debit !== b.debit || a.credit !== b.credit) continue;
      if (amount(a) === 0) continue;
      if (normalizedBeneficiary(a.beneficiary) !== normalizedBeneficiary(b.beneficiary)) continue;
      if (daysBetween(a.transactionDate!, b.transactionDate!) > windowDays) continue;

      const signal: BankingIntelligenceSignal = {
        kind: "duplicate-payment",
        message: `Possible duplicate: two payments of ${amount(a).toFixed(2)} to ${a.beneficiary} within ${windowDays} days.`,
        reasoning: `Transactions ${a.id} and ${b.id} share the same beneficiary, amount, and direction, dated within ${windowDays} day(s) of each other.`,
        confidence: 70,
        suggestedAction: "Confirm both payments were genuinely separate before allocating either.",
      };
      signals.set(a.id, signal);
      signals.set(b.id, signal);
    }
  }

  return signals;
}

/** The first time a beneficiary appears in a company's transaction
 * history (chronologically) — genuinely new, not previously matched to a
 * merchant/supplier/customer default. */
export function detectNewMerchants(transactions: IntelligenceTransaction[]): Map<number, BankingIntelligenceSignal> {
  const signals = new Map<number, BankingIntelligenceSignal>();
  const sorted = [...transactions]
    .filter((t) => t.transactionDate !== null && t.beneficiary.trim() !== "")
    .sort((a, b) => (a.transactionDate! < b.transactionDate! ? -1 : a.transactionDate! > b.transactionDate! ? 1 : a.id - b.id));

  const seen = new Set<string>();
  for (const t of sorted) {
    const key = normalizedBeneficiary(t.beneficiary);
    if (!seen.has(key)) {
      seen.add(key);
      signals.set(t.id, {
        kind: "new-merchant",
        message: `First transaction seen from "${t.beneficiary}".`,
        reasoning: "No earlier transaction in this company's history shares this beneficiary.",
        confidence: 100,
        suggestedAction: "Assign a Merchant record so future payments to this beneficiary resolve automatically.",
      });
    }
  }

  return signals;
}

/** An amount more than 2x a beneficiary's own historical average,
 * requiring at least 3 prior payments to that beneficiary so a single
 * early transaction is never flagged against itself. */
export function detectUnusualSpending(transactions: IntelligenceTransaction[]): Map<number, BankingIntelligenceSignal> {
  const signals = new Map<number, BankingIntelligenceSignal>();
  const byBeneficiary = new Map<string, IntelligenceTransaction[]>();
  for (const t of transactions) {
    if (t.transactionDate === null || amount(t) === 0) continue;
    const key = normalizedBeneficiary(t.beneficiary);
    const group = byBeneficiary.get(key) ?? [];
    group.push(t);
    byBeneficiary.set(key, group);
  }

  for (const group of byBeneficiary.values()) {
    const sorted = [...group].sort((a, b) => (a.transactionDate! < b.transactionDate! ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      const priors = sorted.slice(0, i);
      if (priors.length < 3) continue;
      const priorAverage = priors.reduce((sum, t) => sum + amount(t), 0) / priors.length;
      if (priorAverage <= 0) continue;
      const current = sorted[i];
      const ratio = amount(current) / priorAverage;
      if (ratio >= 2) {
        signals.set(current.id, {
          kind: "unusual-spending",
          message: `${amount(current).toFixed(2)} to ${current.beneficiary} is ${ratio.toFixed(1)}x this beneficiary's typical amount.`,
          reasoning: `Average of the ${priors.length} prior payment(s) to this beneficiary is ${priorAverage.toFixed(2)}.`,
          confidence: Math.min(90, 50 + Math.round((ratio - 2) * 10)),
          suggestedAction: "Review before allocating — confirm the amount is correct.",
        });
      }
    }
  }

  return signals;
}

/** A single debit whose size dominates the company's trailing 30-day
 * outflow — a real, computed "cash-flow impact" signal, not a fabricated
 * one. */
export function detectCashFlowImpact(transactions: IntelligenceTransaction[], thresholdPercent = 20, windowDays = 30): Map<number, BankingIntelligenceSignal> {
  const signals = new Map<number, BankingIntelligenceSignal>();
  const debits = transactions.filter((t) => t.transactionDate !== null && t.debit > 0);

  for (const t of debits) {
    const windowTotal = debits
      .filter((other) => daysBetween(other.transactionDate!, t.transactionDate!) <= windowDays)
      .reduce((sum, other) => sum + other.debit, 0);
    if (windowTotal <= 0) continue;
    const share = (t.debit / windowTotal) * 100;
    if (share >= thresholdPercent) {
      signals.set(t.id, {
        kind: "cash-flow-impact",
        message: `This payment is ${share.toFixed(0)}% of total outflow in the surrounding ${windowDays} days.`,
        reasoning: `${t.debit.toFixed(2)} out of ${windowTotal.toFixed(2)} total debits in the ${windowDays}-day window around this transaction.`,
        confidence: 80,
        suggestedAction: "Confirm cash is available to cover this payment alongside other outflows in the same period.",
      });
    }
  }

  return signals;
}

/** A heuristic risk flag, never a fraud determination — a new merchant
 * receiving an unusually large payment is exactly the combination a
 * human reviewer would want surfaced, framed with an honest confidence
 * rather than a bare "Fraud" label. */
export function detectSuspiciousPatterns(transactions: IntelligenceTransaction[], newMerchants: Map<number, BankingIntelligenceSignal>, largePaymentThreshold: number): Map<number, BankingIntelligenceSignal> {
  const signals = new Map<number, BankingIntelligenceSignal>();
  for (const t of transactions) {
    if (!newMerchants.has(t.id)) continue;
    if (amount(t) < largePaymentThreshold) continue;
    signals.set(t.id, {
      kind: "suspicious-pattern",
      message: `Large payment of ${amount(t).toFixed(2)} to a merchant never seen before.`,
      reasoning: "Combines a first-time beneficiary with a payment above the company's large-payment threshold — a pattern worth a second look, not a confirmed issue.",
      confidence: 55,
      suggestedAction: "Verify the beneficiary and payment details before this is allocated or reconciled.",
    });
  }
  return signals;
}

/** Runs every signal detector once and merges them per transaction — the
 * one function services/UI should call. */
export function buildBankingIntelligence(transactions: IntelligenceTransaction[], largePaymentThreshold = 50_000): Map<number, BankingIntelligenceSignal[]> {
  const duplicates = detectDuplicatePayments(transactions);
  const newMerchants = detectNewMerchants(transactions);
  const unusual = detectUnusualSpending(transactions);
  const cashFlow = detectCashFlowImpact(transactions);
  const suspicious = detectSuspiciousPatterns(transactions, newMerchants, largePaymentThreshold);

  const result = new Map<number, BankingIntelligenceSignal[]>();
  for (const t of transactions) {
    const signals = [duplicates.get(t.id), newMerchants.get(t.id), unusual.get(t.id), cashFlow.get(t.id), suspicious.get(t.id)].filter(
      (s): s is BankingIntelligenceSignal => s !== undefined,
    );
    if (signals.length > 0) result.set(t.id, signals);
  }
  return result;
}
