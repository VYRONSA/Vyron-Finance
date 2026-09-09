/**
 * Customer Matching — which of a customer's own outstanding invoices a
 * particular receipt most likely settles. Unlike the pinned Supplier
 * Matching Engine (`accounting/matching-engine.ts`), there is no
 * beneficiary-name lookup needed here: a `CustomerReceipt` already
 * carries a real `customerId`, so the search space is already scoped to
 * that one customer's own open invoices — the open question is only
 * WHICH invoice(s). Delegates scoring to the shared Confidence Engine —
 * "No module may calculate its own confidence."
 */

import { bandConfidence, sumConfidence, type ConfidenceBand, type MatchRule } from "@/server/matching/confidence-engine";
import type { CustomerReceipt, SalesInvoice } from "@/server/sales/types";

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

/** How much of this receipt has not yet been allocated to any invoice. */
export function receiptRemaining(receipt: CustomerReceipt): number {
  const allocated = round2(receipt.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  return round2(receipt.amount - allocated);
}

function referenceMatches(receipt: CustomerReceipt, invoice: SalesInvoice): boolean {
  const invoiceNumber = normalize(invoice.invoiceNumber);
  if (!invoiceNumber) return false;
  return normalize(receipt.reference).includes(invoiceNumber);
}

export type AllocationMatchCandidate = {
  receiptId: number;
  invoiceId: number;
  customerId: number;
  score: number;
  band: ConfidenceBand;
  matchedRules: MatchRule[];
  suggestedAmount: number;
};

function scoreCandidate(receipt: CustomerReceipt, invoice: SalesInvoice, remaining: number): { score: number; matchedRules: MatchRule[] } {
  const rules: MatchRule[] = [
    { id: RULE_EXACT_AMOUNT, label: RULE_EXACT_AMOUNT, points: EXACT_AMOUNT_SCORE, matched: Math.abs(remaining - invoice.outstanding) <= AMOUNT_TOLERANCE },
    { id: RULE_REFERENCE_MATCH, label: RULE_REFERENCE_MATCH, points: REFERENCE_MATCH_SCORE, matched: referenceMatches(receipt, invoice) },
    { id: RULE_DATE_PROXIMITY, label: RULE_DATE_PROXIMITY, points: DATE_PROXIMITY_SCORE, matched: daysBetween(receipt.receiptDate, invoice.invoiceDate) <= DATE_PROXIMITY_WINDOW_DAYS },
  ];
  return sumConfidence(rules);
}

/** Every candidate (receipt, invoice) pairing for the SAME customer with
 * a nonzero score, most confident first — the "AI Suggestions" surface.
 * A Posted receipt with unallocated funds against a Posted invoice with
 * outstanding balance is the only real candidate shape; anything else
 * (Draft, fully allocated/settled) is excluded up front. */
export function findAllocationCandidates(receipts: CustomerReceipt[], invoices: SalesInvoice[]): AllocationMatchCandidate[] {
  const openInvoicesByCustomer = new Map<number, SalesInvoice[]>();
  for (const invoice of invoices) {
    if (invoice.status !== "Posted" || invoice.outstanding <= AMOUNT_TOLERANCE) continue;
    const list = openInvoicesByCustomer.get(invoice.customerId) ?? [];
    list.push(invoice);
    openInvoicesByCustomer.set(invoice.customerId, list);
  }

  const candidates: AllocationMatchCandidate[] = [];
  for (const receipt of receipts) {
    if (receipt.status !== "Posted") continue;
    const remaining = receiptRemaining(receipt);
    if (remaining <= AMOUNT_TOLERANCE) continue;

    for (const invoice of openInvoicesByCustomer.get(receipt.customerId) ?? []) {
      const { score, matchedRules } = scoreCandidate(receipt, invoice, remaining);
      if (score <= 0) continue;
      candidates.push({
        receiptId: receipt.id,
        invoiceId: invoice.id,
        customerId: receipt.customerId,
        score,
        band: bandConfidence(score, ALLOCATION_MATCH_THRESHOLD),
        matchedRules,
        suggestedAmount: round2(Math.min(remaining, invoice.outstanding)),
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
