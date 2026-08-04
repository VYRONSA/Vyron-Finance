/**
 * Supplier Matching workspace's application service — the AP mirror of
 * `customer-matching-service.ts`. Every allocation, auto or manual,
 * still goes through `supplier-payment-service.ts::allocatePayment`.
 * Purchase Orders and GRNs are surfaced read-only from their own
 * existing services (for the 3-way-match visibility the directive asks
 * for) — never a second PO/GRN implementation.
 */

import { listSupplierPayments, allocatePayment } from "@/server/services/supplier-payment-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listPurchaseOrdersBySupplier } from "@/server/services/purchase-order-service";
import { listGoodsReceivedNotes } from "@/server/services/goods-received-note-service";
import { findPaymentAllocationCandidates, type PaymentAllocationMatchCandidate } from "@/server/matching/payment-allocation-matching-engine";
import { buildSupplierStatement, type StatementEntry } from "@/server/matching/supplier-statement-engine";
import { recordOverride } from "@/server/repositories/matching-override-repository";
import type { ImportedBill } from "@/server/accounting/types";
import type { SupplierPayment } from "@/server/purchasing/types";
import type { PurchaseOrder, GoodsReceivedNote } from "@/server/purchasing/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type SupplierMatchingWorkspaceData = {
  bills: ImportedBill[];
  creditNotes: ImportedBill[];
  debitNotes: ImportedBill[];
  payments: SupplierPayment[];
  candidates: PaymentAllocationMatchCandidate[];
};

export async function getSupplierMatchingWorkspace(companyId: string): Promise<SupplierMatchingWorkspaceData> {
  const [allBills, payments] = await Promise.all([listAllBills(companyId), listSupplierPayments(companyId)]);
  return {
    bills: allBills.filter((b) => b.documentType === "Bill"),
    creditNotes: allBills.filter((b) => b.documentType === "Credit Note"),
    debitNotes: allBills.filter((b) => b.documentType === "Debit Note"),
    payments,
    candidates: findPaymentAllocationCandidates(payments, allBills),
  };
}

export async function getSupplierStatement(companyId: string, supplierId: number): Promise<StatementEntry[]> {
  const [allBills, payments] = await Promise.all([listAllBills(companyId), listSupplierPayments(companyId)]);
  return buildSupplierStatement(
    allBills.filter((b) => b.supplierId === supplierId),
    payments.filter((p) => p.supplierId === supplierId),
  );
}

export async function getSupplierMatchingDocuments(companyId: string, supplierId: number): Promise<{ purchaseOrders: PurchaseOrder[]; goodsReceivedNotes: GoodsReceivedNote[] }> {
  const [purchaseOrders, allGrns] = await Promise.all([
    listPurchaseOrdersBySupplier(companyId, supplierId),
    listGoodsReceivedNotes(companyId),
  ]);
  return { purchaseOrders, goodsReceivedNotes: allGrns.filter((g) => g.supplierId === supplierId) };
}

/** Manual Matching — mirrors `customer-matching-service.ts::manualAllocate`. */
export async function manualAllocate(companyId: string, paymentId: number, billId: number, amount: number, performedBy: string): Promise<void> {
  await allocatePayment(companyId, paymentId, billId, amount);
  await recordOverride(companyId, {
    itemType: "SupplierPaymentAllocation",
    itemId: paymentId,
    fieldName: "billId",
    oldValue: null,
    newValue: String(billId),
    reason: `Manual allocation of ${amount} to bill ${billId}`,
    performedBy,
  });
}

export type AutoAllocateOutcome = { allocated: number; totalAmount: number; failures: string[] };

/** Auto Matching — mirrors `customer-matching-service.ts::autoAllocateCustomerMatches`. */
export async function autoAllocateSupplierMatches(companyId: string, performedBy: string): Promise<AutoAllocateOutcome> {
  const [allBills, payments] = await Promise.all([listAllBills(companyId), listSupplierPayments(companyId)]);
  const candidates = findPaymentAllocationCandidates(payments, allBills).filter((c) => c.band === "Matched");

  const remainingByPayment = new Map<number, number>();
  const outstandingByBill = new Map<number, number>();
  for (const p of payments) remainingByPayment.set(p.id, p.amount - p.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  for (const b of allBills) outstandingByBill.set(b.id, b.outstanding);

  let allocated = 0;
  let totalAmount = 0;
  const failures: string[] = [];

  for (const candidate of candidates) {
    const remaining = round2(remainingByPayment.get(candidate.paymentId) ?? 0);
    const outstanding = round2(outstandingByBill.get(candidate.billId) ?? 0);
    const amount = round2(Math.min(remaining, outstanding));
    if (amount <= 0.01) continue;

    try {
      await allocatePayment(companyId, candidate.paymentId, candidate.billId, amount);
      await recordOverride(companyId, {
        itemType: "SupplierPaymentAllocation",
        itemId: candidate.paymentId,
        fieldName: "billId",
        oldValue: null,
        newValue: String(candidate.billId),
        reason: `Auto-allocated at ${candidate.score}% confidence`,
        performedBy,
      });
      remainingByPayment.set(candidate.paymentId, round2(remaining - amount));
      outstandingByBill.set(candidate.billId, round2(outstanding - amount));
      allocated += 1;
      totalAmount = round2(totalAmount + amount);
    } catch (err) {
      failures.push(`Payment ${candidate.paymentId} -> Bill ${candidate.billId}: ${err instanceof Error ? err.message : "failed to allocate."}`);
    }
  }

  return { allocated, totalAmount, failures };
}
