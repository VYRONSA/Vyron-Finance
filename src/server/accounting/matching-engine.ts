/**
 * Supplier Matching Engine — ported from
 * `accounting_engine/matching_engine.py::SupplierMatchingEngine`.
 *
 * Deterministic, rule-based matching of bank transactions (payments)
 * against imported bills and the supplier master. No ML/fuzzy matching —
 * every match is reproducible from its inputs and carries a confidence
 * score plus the exact list of rules that fired.
 *
 * CONFIDENCE MODEL (kept numerically identical to the Python original —
 * changing any of this is a deliberate, documented decision, not a
 * tunable constant):
 *   Exact Supplier Name               55  (mutually exclusive with Alt Name)
 *   Alternative Supplier Name         45
 *   Invoice Reference in Desc/Ref     30
 *   Exact Amount (Debit == Outstanding) 13
 *   Date Proximity (<= 60 days)        2
 * MATCHED_CONFIDENCE_THRESHOLD = 65 — supplier name alone (55 or 45) never
 * auto-matches; supplier name plus one corroborating signal does.
 */

import type { BankTransactionRecord, ImportedBill, MatchResult, Supplier } from "./types";
import { isPayment } from "./types";
import { bandConfidence, sumConfidence, type MatchRule } from "@/server/matching/confidence-engine";

export const STATUS_MATCHED = "Matched" as const;
export const STATUS_SUGGESTED = "Suggested" as const;
export const STATUS_UNMATCHED = "Unmatched" as const;

export const RULE_EXACT_SUPPLIER_NAME = "Exact Supplier Name";
export const RULE_ALTERNATIVE_SUPPLIER_NAME = "Alternative Supplier Name";
export const RULE_INVOICE_REFERENCE = "Invoice Reference";
export const RULE_EXACT_AMOUNT = "Exact Amount";
export const RULE_DATE_PROXIMITY = "Date Proximity";

export const PAYMENT_TYPE_FULL = "Full Payment" as const;
export const PAYMENT_TYPE_PARTIAL = "Partial Payment" as const;

export const REQUIRED_ACTION_NO_OUTSTANDING_BILL = "Review — no outstanding bill found for this supplier";
export const REQUIRED_ACTION_MULTIPLE_BILLS = "Review — possible multiple invoice payment";
export const REQUIRED_ACTION_DUPLICATE_PAYMENT = "Review — possible duplicate payment";
export const REQUIRED_ACTION_LOW_CONFIDENCE = "Review — confidence below auto-match threshold";

const EXACT_SUPPLIER_NAME_SCORE = 55;
const ALTERNATIVE_SUPPLIER_NAME_SCORE = 45;
const INVOICE_REFERENCE_SCORE = 30;
const EXACT_AMOUNT_SCORE = 13;
const DATE_PROXIMITY_SCORE = 2;

const DATE_PROXIMITY_WINDOW_DAYS = 60;
const AMOUNT_TOLERANCE = 0.01;
const MATCHED_CONFIDENCE_THRESHOLD = 65;

function normalize(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / msPerDay;
}

type SupplierIndexEntry = { supplier: Supplier; rule: string; score: number };

function buildSupplierIndex(suppliers: Supplier[]): Map<string, SupplierIndexEntry> {
  const index = new Map<string, SupplierIndexEntry>();
  // Alternative names registered first so an exact primary name always
  // wins a collision (processed second, so it overwrites).
  for (const supplier of suppliers) {
    for (const alt of supplier.alternativeNames) {
      const key = normalize(alt);
      if (key) index.set(key, { supplier, rule: RULE_ALTERNATIVE_SUPPLIER_NAME, score: ALTERNATIVE_SUPPLIER_NAME_SCORE });
    }
  }
  for (const supplier of suppliers) {
    const key = normalize(supplier.name);
    if (key) index.set(key, { supplier, rule: RULE_EXACT_SUPPLIER_NAME, score: EXACT_SUPPLIER_NAME_SCORE });
  }
  return index;
}

function buildBillsIndex(bills: ImportedBill[]): Map<number, ImportedBill[]> {
  const index = new Map<number, ImportedBill[]>();
  for (const bill of bills) {
    if (bill.supplierId !== null && bill.outstanding > AMOUNT_TOLERANCE) {
      const list = index.get(bill.supplierId) ?? [];
      list.push(bill);
      index.set(bill.supplierId, list);
    }
  }
  return index;
}

function referenceMatches(transaction: BankTransactionRecord, bill: ImportedBill): boolean {
  const invoiceNumber = normalize(bill.invoiceNumber);
  if (!invoiceNumber) return false;
  const haystacks = [normalize(transaction.description), normalize(transaction.reference)];
  return haystacks.some((haystack) => haystack && haystack.includes(invoiceNumber));
}

function dateProximityHit(transaction: BankTransactionRecord, bill: ImportedBill): boolean {
  if (!transaction.transactionDate) return false;
  for (const referenceDate of [bill.dueDate, bill.invoiceDate]) {
    if (referenceDate && daysBetween(transaction.transactionDate, referenceDate) <= DATE_PROXIMITY_WINDOW_DAYS) {
      return true;
    }
  }
  return false;
}

/** Delegates to the ONE shared Confidence Engine (`sumConfidence`) rather
 * than accumulating its own score — same rule set, same point values,
 * same evaluation order as before this file existed; `matching-engine.test.ts`
 * (a numerically-pinned port of the Python reference's own test suite)
 * is the behavior-preservation proof for this refactor. */
function scoreBill(
  transaction: BankTransactionRecord,
  bill: ImportedBill,
  supplierRule: string,
  supplierScore: number,
): { score: number; rules: string[] } {
  const matchRules: MatchRule[] = [
    { id: supplierRule, label: supplierRule, points: supplierScore, matched: true },
    { id: RULE_INVOICE_REFERENCE, label: RULE_INVOICE_REFERENCE, points: INVOICE_REFERENCE_SCORE, matched: referenceMatches(transaction, bill) },
    { id: RULE_EXACT_AMOUNT, label: RULE_EXACT_AMOUNT, points: EXACT_AMOUNT_SCORE, matched: Math.abs(transaction.debit - bill.outstanding) <= AMOUNT_TOLERANCE },
    { id: RULE_DATE_PROXIMITY, label: RULE_DATE_PROXIMITY, points: DATE_PROXIMITY_SCORE, matched: dateProximityHit(transaction, bill) },
  ];
  const { score, matchedRules } = sumConfidence(matchRules);
  return { score, rules: matchedRules.map((r) => r.label) };
}

function evaluateOne(
  transaction: BankTransactionRecord,
  supplierIndex: Map<string, SupplierIndexEntry>,
  billsBySupplier: Map<number, ImportedBill[]>,
  claimed: Set<number>,
): MatchResult {
  const base = {
    bankTransactionId: transaction.id,
    matchedSupplierId: null,
    matchedBillId: null,
    confidence: 0,
    rulesTriggered: [] as string[],
    paymentType: null,
    requiredAction: null,
    candidateBillIds: [] as number[],
  };

  if (!isPayment(transaction)) {
    return {
      ...base,
      status: STATUS_UNMATCHED,
      reason: "Not a payment (Debit is zero) — supplier matching only applies to outgoing payments.",
    };
  }

  const match = supplierIndex.get(normalize(transaction.beneficiary));
  if (!match) {
    return {
      ...base,
      status: STATUS_UNMATCHED,
      reason: `No supplier found matching beneficiary '${transaction.beneficiary}'.`,
    };
  }
  const { supplier, rule: supplierRule, score: supplierScore } = match;

  const candidateBills = billsBySupplier.get(supplier.id) ?? [];
  if (candidateBills.length === 0) {
    return {
      ...base,
      status: STATUS_SUGGESTED,
      matchedSupplierId: supplier.id,
      confidence: supplierScore,
      rulesTriggered: [supplierRule],
      reason: `Supplier '${supplier.name}' matched (${supplierRule}) but has no outstanding bills to allocate against.`,
      requiredAction: REQUIRED_ACTION_NO_OUTSTANDING_BILL,
    };
  }

  const scored = candidateBills
    .map((bill) => ({ bill, ...scoreBill(transaction, bill, supplierRule, supplierScore) }))
    .sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const topBill = scored[0].bill;
  const topRules = scored[0].rules;
  const tied = scored.filter((item) => item.score === topScore);

  const isPartial = transaction.debit < topBill.outstanding - AMOUNT_TOLERANCE;
  const paymentType: MatchResult["paymentType"] = isPartial ? PAYMENT_TYPE_PARTIAL : PAYMENT_TYPE_FULL;

  let reason = `${topRules.join(", ")} matched.`;
  if (isPartial) {
    reason += ` Partial payment: ${transaction.debit.toFixed(2)} of ${topBill.outstanding.toFixed(2)} outstanding.`;
  }

  if (tied.length > 1) {
    return {
      ...base,
      status: STATUS_SUGGESTED,
      matchedSupplierId: supplier.id,
      confidence: topScore,
      rulesTriggered: topRules,
      reason: reason + ` ${tied.length} bills scored equally — cannot determine which one this payment is for.`,
      paymentType,
      requiredAction: REQUIRED_ACTION_MULTIPLE_BILLS,
      candidateBillIds: tied.map((item) => item.bill.id),
    };
  }

  if (claimed.has(topBill.id)) {
    return {
      ...base,
      status: STATUS_SUGGESTED,
      matchedSupplierId: supplier.id,
      matchedBillId: topBill.id,
      confidence: topScore,
      rulesTriggered: topRules,
      reason: reason + ` Bill ${topBill.invoiceNumber} already has a matched payment.`,
      paymentType,
      requiredAction: REQUIRED_ACTION_DUPLICATE_PAYMENT,
      candidateBillIds: [topBill.id],
    };
  }

  const status = bandConfidence(topScore, MATCHED_CONFIDENCE_THRESHOLD) === "Matched" ? STATUS_MATCHED : STATUS_SUGGESTED;
  const requiredAction = status === STATUS_MATCHED ? null : REQUIRED_ACTION_LOW_CONFIDENCE;
  return {
    ...base,
    status,
    matchedSupplierId: supplier.id,
    matchedBillId: topBill.id,
    confidence: topScore,
    rulesTriggered: topRules,
    reason,
    paymentType,
    requiredAction,
    candidateBillIds: [topBill.id],
  };
}

/**
 * Evaluate many transactions against the same supplier/bill universe.
 * `companyId` scopes the call defensively: any supplier or bill belonging
 * to a different company throws immediately — matching can never cross a
 * company boundary regardless of caller discipline.
 */
export function evaluateBatch(
  companyId: string,
  transactions: BankTransactionRecord[],
  suppliers: Supplier[],
  bills: ImportedBill[],
  alreadyMatchedBillIds: Set<number> = new Set(),
): MatchResult[] {
  for (const supplier of suppliers) {
    if (supplier.companyId !== companyId) {
      throw new Error(
        `Supplier ${supplier.id} (${supplier.name}) belongs to company ${supplier.companyId}, not ${companyId} — refusing to match across companies.`,
      );
    }
  }
  for (const bill of bills) {
    if (bill.companyId !== companyId) {
      throw new Error(
        `Bill ${bill.id} (${bill.invoiceNumber}) belongs to company ${bill.companyId}, not ${companyId} — refusing to match across companies.`,
      );
    }
  }

  const supplierIndex = buildSupplierIndex(suppliers);
  const billsBySupplier = buildBillsIndex(bills);
  const claimed = new Set(alreadyMatchedBillIds);

  const results: MatchResult[] = [];
  for (const transaction of transactions) {
    const result = evaluateOne(transaction, supplierIndex, billsBySupplier, claimed);
    if (result.status === STATUS_MATCHED && result.matchedBillId !== null) {
      claimed.add(result.matchedBillId);
    }
    results.push(result);
  }
  return results;
}
