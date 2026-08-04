/**
 * Allocation Engine — ported from
 * `accounting_engine/allocation_engine.py::AllocationEngine`.
 *
 * Converts Matching Engine results into accounting allocations (a GL
 * account, a VAT code, and a final allocation status) without ever
 * recalculating match confidence — that's carried straight through from
 * the Matching Engine — and without posting a journal.
 *
 * Every transaction ends this engine in exactly one of four states:
 *   Matched      A specific bill was matched with high confidence — use
 *                the bill's (or its supplier's) GL/VAT, never overridden.
 *   Allocated    No bill matched, but the supplier is known and has
 *                usable defaults.
 *   Suggested    Ambiguous/duplicate/low-confidence match, or a known
 *                supplier with no bill and no usable defaults — GL/VAT
 *                may be suggested but never auto-confirmed.
 *   Unallocated  No supplier identified at all.
 */

import {
  REQUIRED_ACTION_DUPLICATE_PAYMENT,
  REQUIRED_ACTION_LOW_CONFIDENCE,
  REQUIRED_ACTION_MULTIPLE_BILLS,
  REQUIRED_ACTION_NO_OUTSTANDING_BILL,
  STATUS_MATCHED,
} from "./matching-engine";
import type { AllocationResult, BankTransactionRecord, ImportedBill, Supplier } from "./types";

export const STATUS_ALLOCATED = "Allocated" as const;
export const STATUS_SUGGESTED_ALLOCATION = "Suggested" as const;
export const STATUS_UNALLOCATED = "Unallocated" as const;

export const METHOD_MATCHED_BILL = "Matched Bill" as const;
export const METHOD_SUPPLIER_DEFAULT = "Supplier Default" as const;

const REVIEW_REQUIRED_ACTIONS = new Set([
  REQUIRED_ACTION_MULTIPLE_BILLS,
  REQUIRED_ACTION_DUPLICATE_PAYMENT,
  REQUIRED_ACTION_LOW_CONFIDENCE,
]);

export function evaluate(
  transaction: BankTransactionRecord,
  supplier: Supplier | null,
  bill: ImportedBill | null,
): AllocationResult {
  const confidence = transaction.confidenceScore ?? 0;

  // Rule 3: Unknown supplier — nothing to allocate against at all.
  if (transaction.matchedSupplierId === null || supplier === null) {
    return {
      bankTransactionId: transaction.id,
      status: STATUS_UNALLOCATED,
      supplierId: null,
      glAccount: null,
      vatCode: null,
      confidence,
      allocationMethod: null,
      allocationReason: transaction.matchReason || "No supplier identified by the Matching Engine.",
      requiredAction: transaction.requiredAction,
    };
  }

  // Rule 1: Matched Bill — use the bill's own values where present,
  // falling back to the supplier's defaults for whichever of GL/VAT the
  // bill doesn't carry. The match itself is never overridden.
  if (transaction.allocationStatus === STATUS_MATCHED && bill !== null) {
    return {
      bankTransactionId: transaction.id,
      status: STATUS_MATCHED,
      supplierId: supplier.id,
      glAccount: bill.glAccount || supplier.defaultGlAccount,
      vatCode: bill.vatCode || supplier.defaultVatCode,
      confidence,
      allocationMethod: METHOD_MATCHED_BILL,
      allocationReason: `Matched to bill ${bill.invoiceNumber} (${transaction.matchReason}) GL/VAT taken from the bill where available, supplier defaults otherwise.`,
      requiredAction: null,
    };
  }

  // Rule 4: Ambiguous / possible duplicate / low-confidence — never
  // auto-confirm; still surface a suggested GL/VAT for a human reviewer.
  if (transaction.requiredAction && REVIEW_REQUIRED_ACTIONS.has(transaction.requiredAction)) {
    const glAccount = (bill?.glAccount ?? null) || supplier.defaultGlAccount;
    const vatCode = (bill?.vatCode ?? null) || supplier.defaultVatCode;
    return {
      bankTransactionId: transaction.id,
      status: STATUS_SUGGESTED_ALLOCATION,
      supplierId: supplier.id,
      glAccount,
      vatCode,
      confidence,
      allocationMethod: bill !== null ? METHOD_MATCHED_BILL : METHOD_SUPPLIER_DEFAULT,
      allocationReason: `${transaction.matchReason} GL/VAT suggested pending review — not confirmed.`,
      requiredAction: transaction.requiredAction,
    };
  }

  // Rule 2: Known supplier, no bill at all — use supplier defaults if any.
  if (transaction.requiredAction === REQUIRED_ACTION_NO_OUTSTANDING_BILL) {
    if (supplier.defaultGlAccount) {
      return {
        bankTransactionId: transaction.id,
        status: STATUS_ALLOCATED,
        supplierId: supplier.id,
        glAccount: supplier.defaultGlAccount,
        vatCode: supplier.defaultVatCode,
        confidence,
        allocationMethod: METHOD_SUPPLIER_DEFAULT,
        allocationReason: `No bill matched; supplier '${supplier.name}' defaults applied.`,
        requiredAction: null,
      };
    }
    return {
      bankTransactionId: transaction.id,
      status: STATUS_SUGGESTED_ALLOCATION,
      supplierId: supplier.id,
      glAccount: null,
      vatCode: null,
      confidence,
      allocationMethod: null,
      allocationReason: `Supplier '${supplier.name}' matched but has no default GL/VAT configured.`,
      requiredAction: "Review — supplier has no default GL/VAT configured",
    };
  }

  // Fallback: supplier known but none of the above applied — stay
  // Suggested rather than guessing.
  return {
    bankTransactionId: transaction.id,
    status: STATUS_SUGGESTED_ALLOCATION,
    supplierId: supplier.id,
    glAccount: null,
    vatCode: null,
    confidence,
    allocationMethod: null,
    allocationReason: transaction.matchReason || "",
    requiredAction: transaction.requiredAction,
  };
}

/**
 * Evaluate many transactions at once. `companyId` scoping is enforced the
 * same defensive way as the Matching Engine: any supplier or bill
 * belonging to a different company throws immediately.
 */
export function evaluateBatch(
  companyId: string,
  transactions: BankTransactionRecord[],
  suppliers: Supplier[],
  bills: ImportedBill[],
): AllocationResult[] {
  for (const supplier of suppliers) {
    if (supplier.companyId !== companyId) {
      throw new Error(
        `Supplier ${supplier.id} (${supplier.name}) belongs to company ${supplier.companyId}, not ${companyId} — refusing to allocate across companies.`,
      );
    }
  }
  for (const bill of bills) {
    if (bill.companyId !== companyId) {
      throw new Error(
        `Bill ${bill.id} (${bill.invoiceNumber}) belongs to company ${bill.companyId}, not ${companyId} — refusing to allocate across companies.`,
      );
    }
  }

  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
  const billsById = new Map(bills.map((b) => [b.id, b]));

  return transactions.map((transaction) =>
    evaluate(
      transaction,
      transaction.matchedSupplierId !== null ? (suppliersById.get(transaction.matchedSupplierId) ?? null) : null,
      transaction.matchedBillId !== null ? (billsById.get(transaction.matchedBillId) ?? null) : null,
    ),
  );
}
