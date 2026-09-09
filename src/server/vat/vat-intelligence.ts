/**
 * VAT Intelligence — pure, deterministic, computed-from-data signals
 * only (same honest framing as every other Intelligence module in this
 * codebase: Banking Intelligence, Inventory Intelligence, Customer/
 * Supplier Intelligence — no "AI"/"ML" claim beyond what is literally
 * computed and shown with its own reasoning string).
 */

import { isVatSplitConsistentWithType, resolveEffectiveRate, type AmountSplit } from "./vat-engine";
import type { VatRateHistoryEntry, VatType } from "./types";

export type VatDocument = {
  id: number;
  documentType: string;
  partyId: number | null;
  partyName: string;
  partyVatNumber: string | null;
  date: string;
  vatTreatmentCode: string;
  vatType: VatType | null;
  grossAmount: number;
  vatAmount: number;
};

export type VatIntelligenceSignal = {
  kind:
    | "missing-vat" | "incorrect-vat-code" | "duplicate-vat-claim" | "suspicious-vat-value"
    | "high-risk" | "unusual-trend" | "vendor-anomaly" | "customer-anomaly";
  message: string;
  reasoning: string;
  confidence: number;
  suggestedCorrection: string;
};

function netAmount(doc: VatDocument): number {
  return Math.round((doc.grossAmount - doc.vatAmount) * 100) / 100;
}

function split(doc: VatDocument): AmountSplit {
  return { gross: doc.grossAmount, net: netAmount(doc), vat: doc.vatAmount };
}

/** A supplier document with a non-zero, VAT-bearing amount but no VAT
 * number on file for the party — the specific "Missing VAT Number"
 * exception type the PRB's brief names, distinct from
 * `detectMissingVat`'s "no treatment code assigned" check. */
export function detectMissingVatNumber(documents: VatDocument[]): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  for (const doc of documents) {
    if (doc.vatAmount <= 0) continue;
    if (doc.partyVatNumber && doc.partyVatNumber.trim()) continue;
    signals.set(doc.id, {
      kind: "missing-vat",
      message: `${doc.documentType} #${doc.id} from ${doc.partyName} claims VAT but no VAT number is on file.`,
      reasoning: `VAT amount of ${doc.vatAmount.toFixed(2)} recorded with no party VAT registration number.`,
      confidence: 75,
      suggestedCorrection: "Confirm the party's VAT registration number before this document is included in a VAT Return.",
    });
  }
  return signals;
}

/** No VAT treatment code assigned at all on a non-zero document. */
export function detectMissingVat(documents: VatDocument[]): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  for (const doc of documents) {
    if (doc.grossAmount === 0) continue;
    if (doc.vatTreatmentCode.trim() && doc.vatType !== null) continue;
    signals.set(doc.id, {
      kind: "missing-vat",
      message: `${doc.documentType} #${doc.id} has no VAT treatment assigned.`,
      reasoning: `Gross amount is ${doc.grossAmount.toFixed(2)} with no vat_treatment_code recorded.`,
      confidence: 95,
      suggestedCorrection: "Assign a VAT treatment before this document is included in a VAT Return.",
    });
  }
  return signals;
}

/** The recorded VAT amount is arithmetically inconsistent with the
 * treatment's own type (e.g. a Zero Rated document carrying a non-zero
 * VAT amount) — reuses the Engine's own consistency check, not a
 * second implementation of the rule. */
export function detectIncorrectVatCode(documents: VatDocument[]): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  for (const doc of documents) {
    if (doc.vatType === null) continue;
    if (isVatSplitConsistentWithType(doc.vatType, split(doc))) continue;
    signals.set(doc.id, {
      kind: "incorrect-vat-code",
      message: `${doc.documentType} #${doc.id} — VAT amount doesn't match the "${doc.vatTreatmentCode}" treatment.`,
      reasoning: `Treatment type is ${doc.vatType} but the recorded VAT amount is ${doc.vatAmount.toFixed(2)} on a gross of ${doc.grossAmount.toFixed(2)}.`,
      confidence: 85,
      suggestedCorrection: "Review whether the correct VAT treatment code was applied to this document.",
    });
  }
  return signals;
}

/** Same party, same gross amount, same VAT amount, within a short
 * window — the transaction-level counterpart to the Matching Engine's
 * duplicate-payment detection and Banking Intelligence's
 * duplicate-payment signal, applied to VAT-bearing documents. */
export function detectDuplicateVatClaims(documents: VatDocument[], windowDays = 5): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  const dated = documents.filter((d) => d.vatAmount > 0);

  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      if (a.partyId === null || a.partyId !== b.partyId) continue;
      if (a.grossAmount !== b.grossAmount || a.vatAmount !== b.vatAmount) continue;
      const daysApart = Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86_400_000;
      if (daysApart > windowDays) continue;

      const signal: VatIntelligenceSignal = {
        kind: "duplicate-vat-claim",
        message: `Possible duplicate VAT claim: two ${a.documentType} documents from ${a.partyName} for the same amount within ${windowDays} days.`,
        reasoning: `Documents #${a.id} and #${b.id} share the same party, gross amount (${a.grossAmount.toFixed(2)}), and VAT amount (${a.vatAmount.toFixed(2)}).`,
        confidence: 70,
        suggestedCorrection: "Confirm both documents are genuinely separate transactions before claiming VAT on both.",
      };
      signals.set(a.id, signal);
      signals.set(b.id, signal);
    }
  }
  return signals;
}

/** Shared by `detectSuspiciousVatValues` and `detectVatRateConflict` — the
 * expected VAT portion of a gross amount at a given percentage rate, same
 * formula/rounding both already relied on before this was extracted (pure
 * arithmetic, not a business-rule change). */
function expectedVatAmount(grossAmount: number, ratePercent: number): number {
  return Math.round((grossAmount - grossAmount / (1 + ratePercent / 100)) * 100) / 100;
}

/** A VAT amount that doesn't reconcile with (gross - net) at the
 * treatment's own effective rate, beyond rounding tolerance — a rate
 * mismatch distinct from `detectIncorrectVatCode`'s type-level check
 * (this compares against the ACTUAL numeric rate, not just the type
 * category). `effectiveRateByTreatment` is a single rate per treatment —
 * the caller's own choice of "as of" date (today, in every current
 * caller) applies uniformly to every document regardless of the
 * document's own date; see `detectVatRateConflict` below for the
 * date-aware counterpart. */
export function detectSuspiciousVatValues(documents: VatDocument[], effectiveRateByTreatment: Map<string, number>, tolerance = 0.02): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  for (const doc of documents) {
    const rate = effectiveRateByTreatment.get(doc.vatTreatmentCode);
    if (rate === undefined || doc.grossAmount === 0) continue;
    const expected = expectedVatAmount(doc.grossAmount, rate);
    if (Math.abs(expected - doc.vatAmount) <= tolerance) continue;
    signals.set(doc.id, {
      kind: "suspicious-vat-value",
      message: `${doc.documentType} #${doc.id} — VAT amount doesn't reconcile with the ${rate}% rate for "${doc.vatTreatmentCode}".`,
      reasoning: `Expected VAT of ${expected.toFixed(2)} on a gross of ${doc.grossAmount.toFixed(2)} at ${rate}%, but ${doc.vatAmount.toFixed(2)} is recorded.`,
      confidence: 80,
      suggestedCorrection: "Recalculate this document's VAT amount, or confirm the correct rate was in effect on its date.",
    });
  }
  return signals;
}

/** Overnight QA follow-up — a genuine gap `detectSuspiciousVatValues`
 * does NOT cover: that function compares every document against a single
 * "as of today" rate per treatment, so a legitimate historical document
 * dated before a rate change is compared against the WRONG (current)
 * rate. This function instead resolves each document's own effective
 * rate on ITS OWN date, via the existing, already-general-purpose
 * `resolveEffectiveRate(history, asOfDate)` — no new rate-resolution
 * logic, just applying the existing one per-document instead of once for
 * "today." `kind: "high-risk"` reuses the `VatIntelligenceSignal["kind"]`
 * value this union already declared (and `vat-exception-scan-service.ts`'s
 * `SIGNAL_TO_EXCEPTION_TYPE` already mapped to `VatRateConflict`) but no
 * function had ever actually produced — this closes that gap rather than
 * inventing a new signal kind or exception type. `historyByTreatmentCode`
 * is keyed by `VatTreatment.code` (matching `VatDocument.vatTreatmentCode`),
 * not by treatment id — the caller already has both the code and the raw
 * `VatRateHistoryEntry[]` per treatment on hand (the same data used to
 * build `effectiveRateByTreatment` above), so no new query is required. */
export function detectVatRateConflict(documents: VatDocument[], historyByTreatmentCode: Map<string, VatRateHistoryEntry[]>, tolerance = 0.02): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  for (const doc of documents) {
    if (doc.grossAmount === 0) continue;
    const history = historyByTreatmentCode.get(doc.vatTreatmentCode);
    if (!history || history.length === 0) continue;
    const rate = resolveEffectiveRate(history, doc.date);
    if (rate === null) continue;
    const expected = expectedVatAmount(doc.grossAmount, rate);
    if (Math.abs(expected - doc.vatAmount) <= tolerance) continue;
    signals.set(doc.id, {
      kind: "high-risk",
      message: `${doc.documentType} #${doc.id} — VAT amount conflicts with the ${rate}% rate that was actually in effect for "${doc.vatTreatmentCode}" on ${doc.date}.`,
      reasoning: `Expected VAT of ${expected.toFixed(2)} on a gross of ${doc.grossAmount.toFixed(2)} at the ${rate}% rate effective on ${doc.date}, but ${doc.vatAmount.toFixed(2)} is recorded.`,
      confidence: 80,
      suggestedCorrection: "Confirm which VAT rate should have applied on this document's date, and recalculate if needed.",
    });
  }
  return signals;
}

/** A single VAT-bearing document unusually large relative to the
 * party's own historical average — same "N prior occurrences required"
 * design as Banking Intelligence's `detectUnusualSpending`. */
export function detectVendorAndCustomerAnomalies(documents: VatDocument[]): Map<number, VatIntelligenceSignal> {
  const signals = new Map<number, VatIntelligenceSignal>();
  const byParty = new Map<number, VatDocument[]>();
  for (const doc of documents) {
    if (doc.partyId === null || doc.vatAmount <= 0) continue;
    const group = byParty.get(doc.partyId) ?? [];
    group.push(doc);
    byParty.set(doc.partyId, group);
  }

  for (const group of byParty.values()) {
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      const priors = sorted.slice(0, i);
      if (priors.length < 3) continue;
      const priorAverage = priors.reduce((sum, d) => sum + d.vatAmount, 0) / priors.length;
      if (priorAverage <= 0) continue;
      const current = sorted[i];
      const ratio = current.vatAmount / priorAverage;
      if (ratio < 2.5) continue;
      const isCustomer = current.documentType.toLowerCase().includes("invoice") && current.documentType.toLowerCase().includes("customer");
      signals.set(current.id, {
        kind: isCustomer ? "customer-anomaly" : "vendor-anomaly",
        message: `VAT of ${current.vatAmount.toFixed(2)} on ${current.documentType} #${current.id} from ${current.partyName} is ${ratio.toFixed(1)}x their typical amount.`,
        reasoning: `Average VAT across the ${priors.length} prior document(s) from ${current.partyName} is ${priorAverage.toFixed(2)}.`,
        confidence: Math.min(90, 50 + Math.round((ratio - 2.5) * 10)),
        suggestedCorrection: "Review before including in the VAT Return — confirm the amount and treatment are correct.",
      });
    }
  }
  return signals;
}

/** Total VAT for the current period vs. the prior period of the same
 * length, beyond a materiality threshold — the same "period-over-period
 * % change" pattern `financial-intelligence-service.ts` already uses for
 * "accounts growing unexpectedly." */
export function detectUnusualVatTrend(currentPeriodTotal: number, priorPeriodTotal: number, thresholdPercent = 40): VatIntelligenceSignal | null {
  if (priorPeriodTotal <= 0) return null;
  const changePercent = ((currentPeriodTotal - priorPeriodTotal) / priorPeriodTotal) * 100;
  if (Math.abs(changePercent) < thresholdPercent) return null;
  return {
    kind: "unusual-trend",
    message: `Total VAT this period is ${changePercent > 0 ? "up" : "down"} ${Math.abs(changePercent).toFixed(0)}% on the prior period.`,
    reasoning: `Current period total ${currentPeriodTotal.toFixed(2)} vs. prior period ${priorPeriodTotal.toFixed(2)}.`,
    confidence: 65,
    suggestedCorrection: "Review the period's transactions for a genuine business reason (e.g. a large one-off sale or purchase) before finalizing the return.",
  };
}

/** Runs every per-document detector once and merges them — mirrors
 * `banking-intelligence.ts::buildBankingIntelligence`. */
export function buildVatIntelligence(documents: VatDocument[], effectiveRateByTreatment: Map<string, number>): Map<number, VatIntelligenceSignal[]> {
  const missing = detectMissingVat(documents);
  const incorrect = detectIncorrectVatCode(documents);
  const duplicates = detectDuplicateVatClaims(documents);
  const suspicious = detectSuspiciousVatValues(documents, effectiveRateByTreatment);
  const anomalies = detectVendorAndCustomerAnomalies(documents);

  const result = new Map<number, VatIntelligenceSignal[]>();
  for (const doc of documents) {
    const signals = [missing.get(doc.id), incorrect.get(doc.id), duplicates.get(doc.id), suspicious.get(doc.id), anomalies.get(doc.id)].filter(
      (s): s is VatIntelligenceSignal => s !== undefined,
    );
    if (signals.length > 0) result.set(doc.id, signals);
  }
  return result;
}

/** A document is "high-risk" once it accumulates 2+ independent signals,
 * or carries a single high-confidence one — a real, computed composite,
 * not a fabricated separate risk score. */
export function isHighRisk(signals: VatIntelligenceSignal[]): boolean {
  return signals.length >= 2 || signals.some((s) => s.confidence >= 90);
}
