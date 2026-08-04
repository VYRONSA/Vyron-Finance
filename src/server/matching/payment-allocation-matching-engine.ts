/**
 * Supplier Matching — the mirror image of
 * `receipt-allocation-matching-engine.ts` on the AP side: which of a
 * supplier's own outstanding bills a particular payment most likely
 * settles. `SupplierPayment` already carries a real `supplierId`, so
 * (like the customer side) the search space is already scoped to that
 * supplier's own open bills — the open question is only which bill(s).
 * Delegates scoring to the shared Confidence Engine.
 */

import { bandConfidence, sumConfidence, type ConfidenceBand, type MatchRule } from "@/server/matching/confidence-engine";
import type { SupplierPayment } from "@/server/purchasing/types";
import type { ImportedBill } from "@/server/accounting/types";

export const RULE_EXACT_AMOUNT = "Exact Amount";
export const RULE_REFERENCE_MATCH = "Reference Match";
export const RULE_DATE_PROXIMITY = "Date Proximity";

const EXACT_AMOUNT_SCORE = 50;
const REFERENCE_MATCH_SCORE = 40;
const DATE_PROXIMITY_SCORE = 10;
const DATE_PROXIMITY_WINDOW_DAYS = 30;
const AMOUNT_TOLERANCE = 0.01;

export const ALLOCATION_MATCH_THRESHOLD = 50;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

/** How much of this payment has not yet been allocated to any bill. */
export function paymentRemaining(payment: SupplierPayment): number {
  const allocated = round2(payment.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  return round2(payment.amount - allocated);
}

function referenceMatches(payment: SupplierPayment, bill: ImportedBill): boolean {
  const invoiceNumber = normalize(bill.invoiceNumber);
  if (!invoiceNumber) return false;
  return normalize(payment.reference).includes(invoiceNumber);
}

export type PaymentAllocationMatchCandidate = {
  paymentId: number;
  billId: number;
  supplierId: number;
  score: number;
  band: ConfidenceBand;
  matchedRules: MatchRule[];
  suggestedAmount: number;
};

function scoreCandidate(payment: SupplierPayment, bill: ImportedBill, remaining: number): { score: number; matchedRules: MatchRule[] } {
  const rules: MatchRule[] = [
    { id: RULE_EXACT_AMOUNT, label: RULE_EXACT_AMOUNT, points: EXACT_AMOUNT_SCORE, matched: Math.abs(remaining - bill.outstanding) <= AMOUNT_TOLERANCE },
    { id: RULE_REFERENCE_MATCH, label: RULE_REFERENCE_MATCH, points: REFERENCE_MATCH_SCORE, matched: referenceMatches(payment, bill) },
    { id: RULE_DATE_PROXIMITY, label: RULE_DATE_PROXIMITY, points: DATE_PROXIMITY_SCORE, matched: bill.invoiceDate !== null && daysBetween(payment.paymentDate, bill.invoiceDate) <= DATE_PROXIMITY_WINDOW_DAYS },
  ];
  return sumConfidence(rules);
}

/** Every candidate (payment, bill) pairing for the SAME supplier with a
 * nonzero score, most confident first — mirrors
 * `findAllocationCandidates` on the customer side exactly. */
export function findPaymentAllocationCandidates(payments: SupplierPayment[], bills: ImportedBill[]): PaymentAllocationMatchCandidate[] {
  const openBillsBySupplier = new Map<number, ImportedBill[]>();
  for (const bill of bills) {
    if (bill.supplierId === null || bill.outstanding <= AMOUNT_TOLERANCE) continue;
    const list = openBillsBySupplier.get(bill.supplierId) ?? [];
    list.push(bill);
    openBillsBySupplier.set(bill.supplierId, list);
  }

  const candidates: PaymentAllocationMatchCandidate[] = [];
  for (const payment of payments) {
    if (payment.status !== "Posted") continue;
    const remaining = paymentRemaining(payment);
    if (remaining <= AMOUNT_TOLERANCE) continue;

    for (const bill of openBillsBySupplier.get(payment.supplierId) ?? []) {
      const { score, matchedRules } = scoreCandidate(payment, bill, remaining);
      if (score <= 0) continue;
      candidates.push({
        paymentId: payment.id,
        billId: bill.id,
        supplierId: payment.supplierId,
        score,
        band: bandConfidence(score, ALLOCATION_MATCH_THRESHOLD),
        matchedRules,
        suggestedAmount: round2(Math.min(remaining, bill.outstanding)),
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
