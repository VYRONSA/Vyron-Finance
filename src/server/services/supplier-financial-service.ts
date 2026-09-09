/**
 * Real Supplier financial aggregates and Supplier Intelligence —
 * computed from `ae_imported_bills` (Age Analysis, Outstanding Bills,
 * Purchase History — real since Supplier Management shipped) and, as of
 * the Purchasing Platform (Commercial Platform Module 4),
 * `supplier_payment_allocations` (Average Payment Days) and the bills
 * themselves (Supplier Intelligence, genuinely new — no stub existed
 * before this, unlike Customer Intelligence).
 *
 * Average Payment Days is computed the same way
 * `customer-financial-service.ts::computeAveragePaymentDays` computes it
 * for customers — except here it covers EVERY bill for the supplier
 * regardless of `origin` (imported or Purchasing-entered), since a
 * Supplier Payment can allocate against either. Bills that have never
 * been paid via the new Payments feature simply don't contribute — not
 * fabricated, just not yet real.
 */

import * as repo from "@/server/repositories/supplier-management-repository";
import * as paymentRepo from "@/server/repositories/supplier-payment-repository";
import { computeAgingBuckets, type AgingBuckets } from "@/server/shared/aging";
import type { ImportedBill, Supplier } from "@/server/accounting/types";
import type { SupplierPayment } from "@/server/purchasing/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type SupplierAgingBuckets = AgingBuckets;

/** Thin alias over the shared bucketing logic (`server/shared/aging.ts`,
 * also used by `customer-financial-service.ts`) — kept as its own named
 * export so existing callers/tests don't need to know the logic moved. */
export const computeSupplierAging = computeAgingBuckets;

export type SupplierFinancialSummary = {
  outstandingBalance: number;
  aging: SupplierAgingBuckets;
  averagePaymentDays: number | null;
  lifetimePurchases: number;
  openBillCount: number;
  totalBillCount: number;
};

/** Pure — unit tested. `lifetimePurchases` nets Bills against Credit
 * Notes (a credit note's `total` reduces what was actually spent),
 * matching how a real purchases ledger would net them. */
export function buildSupplierFinancialSummary(bills: ImportedBill[], payments: SupplierPayment[], asOfDate: string): SupplierFinancialSummary {
  const outstandingBalance = round2(bills.reduce((sum, b) => sum + Math.max(b.outstanding, 0), 0));
  const lifetimePurchases = round2(
    bills.reduce((sum, b) => sum + (b.documentType === "Credit Note" ? -b.total : b.total), 0),
  );
  const openBillCount = bills.filter((b) => b.outstanding > 0).length;
  const aging = computeSupplierAging(bills, asOfDate);

  const averagePaymentDays = computeAveragePaymentDays(
    bills,
    payments.flatMap((p) => p.allocations.map((a) => ({ billId: a.billId, allocatedAt: a.createdAt }))),
  );

  return { outstandingBalance, aging, averagePaymentDays, lifetimePurchases, openBillCount, totalBillCount: bills.length };
}

export async function getSupplierFinancialSummary(companyId: string, supplierId: number, asOfDate: string): Promise<SupplierFinancialSummary> {
  const [bills, payments] = await Promise.all([
    repo.listBillsBySupplier(companyId, supplierId),
    paymentRepo.listSupplierPaymentsBySupplier(companyId, supplierId),
  ]);
  return buildSupplierFinancialSummary(bills, payments, asOfDate);
}

export async function getSupplierPurchaseHistory(companyId: string, supplierId: number) {
  return repo.listBillsBySupplier(companyId, supplierId);
}

/** Pure — unit tested. For every bill that's been fully paid off
 * (outstanding === 0, at least one allocation recorded against it), days
 * to pay = its last allocation date minus its invoice date. Returns
 * `null` (not 0) when there's no fully-paid bill yet — an honest "not
 * enough data", mirroring `customer-financial-service.ts`'s identical
 * function. */
export function computeAveragePaymentDays(
  bills: Pick<ImportedBill, "id" | "invoiceDate" | "outstanding">[],
  allocations: { billId: number; allocatedAt: string }[],
): number | null {
  const lastAllocationByBill = new Map<number, string>();
  for (const a of allocations) {
    const existing = lastAllocationByBill.get(a.billId);
    if (!existing || a.allocatedAt > existing) lastAllocationByBill.set(a.billId, a.allocatedAt);
  }

  const daysToPay: number[] = [];
  for (const bill of bills) {
    if (bill.outstanding > 0 || !bill.invoiceDate) continue;
    const lastAllocation = lastAllocationByBill.get(bill.id);
    if (!lastAllocation) continue;
    const days = Math.round((Date.parse(lastAllocation) - Date.parse(bill.invoiceDate)) / 86_400_000);
    daysToPay.push(Math.max(days, 0));
  }

  if (daysToPay.length === 0) return null;
  return Math.round(daysToPay.reduce((sum, d) => sum + d, 0) / daysToPay.length);
}

// ---------------------------------------------------------------------
// Supplier Intelligence — real, computed signals, explicitly not AI/ML
// (same honest framing as Customer Intelligence's own module docstring).
// Genuinely new: no stub existed before this, since the data source
// (bills with a real posting/payment trail) only became meaningful once
// the Purchasing Platform shipped.
// ---------------------------------------------------------------------

export type SupplierIntelligenceSignal = {
  kind:
    | "payment-risk"
    | "largest-bill"
    | "purchase-trend"
    | "average-bill-value"
    | "action-needed"
    | "duplicate-bill"
    | "supplier-risk"
    | "cash-flow-impact";
  message: string;
  reasoning: string;
  confidence: number;
};

/** Pure — unit tested. Every signal is a plain computed fact with a
 * `confidence` reflecting how directly it's derived — not a machine
 * learning score. Covers every bill for this supplier regardless of
 * `origin`, matching Age Analysis/Purchase History's own scope. */
export function buildSupplierIntelligence(
  supplier: Supplier,
  bills: Pick<ImportedBill, "id" | "invoiceNumber" | "documentType" | "invoiceDate" | "dueDate" | "total" | "outstanding">[],
  todayIso: string,
): SupplierIntelligenceSignal[] {
  const signals: SupplierIntelligenceSignal[] = [];
  const active = bills.filter((b) => b.documentType !== "Credit Note");
  const today = Date.parse(todayIso);

  const overdue = active.filter((b) => b.outstanding > 0 && b.dueDate && Date.parse(b.dueDate) < today);
  if (overdue.length > 0) {
    const totalOverdue = round2(overdue.reduce((sum, b) => sum + b.outstanding, 0));
    signals.push({
      kind: "payment-risk",
      message: `${overdue.length} overdue bill(s) totalling ${totalOverdue} owed to ${supplier.name}.`,
      reasoning: `${overdue.length} bill(s) are past their due date with a balance still outstanding — a real risk to the supplier relationship and any negotiated terms.`,
      confidence: 100,
    });
    signals.push({
      kind: "action-needed",
      message: `Pay ${overdue.length} overdue bill(s).`,
      reasoning: "Recommended because at least one bill from this supplier is both overdue and still unpaid.",
      confidence: 90,
    });
  }

  const dueSoon = active.filter((b) => b.outstanding > 0 && b.dueDate && Date.parse(b.dueDate) >= today && Date.parse(b.dueDate) <= today + 7 * 86_400_000);
  if (dueSoon.length > 0) {
    const totalDueSoon = round2(dueSoon.reduce((sum, b) => sum + b.outstanding, 0));
    signals.push({
      kind: "cash-flow-impact",
      message: `${totalDueSoon} due within 7 days across ${dueSoon.length} bill(s).`,
      reasoning: "Sums this supplier's outstanding bills with a due date in the next 7 days — a near-term cash outflow to plan for.",
      confidence: 100,
    });
  }

  if (active.length > 0) {
    const largest = [...active].sort((a, b) => b.total - a.total)[0];
    signals.push({
      kind: "largest-bill",
      message: `Largest bill: ${largest.invoiceNumber} (${largest.total}).`,
      reasoning: "The single largest bill from this supplier, by total.",
      confidence: 100,
    });

    const averageBillValue = round2(active.reduce((sum, b) => sum + b.total, 0) / active.length);
    signals.push({
      kind: "average-bill-value",
      message: `Average bill value: ${averageBillValue}.`,
      reasoning: `Computed across ${active.length} bill(s).`,
      confidence: 100,
    });
  }

  // Same account+date+amount pattern the Financial Intelligence engine
  // uses for duplicate journals, and Customer Intelligence for duplicate
  // invoices — here, duplicate bills.
  const groups = new Map<string, typeof active>();
  for (const bill of active) {
    if (!bill.invoiceDate) continue;
    const key = `${bill.invoiceDate}|${bill.total}`;
    const group = groups.get(key) ?? [];
    group.push(bill);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      signals.push({
        kind: "duplicate-bill",
        message: `${group.length} bills dated ${group[0].invoiceDate} for the same amount (${group[0].total}).`,
        reasoning: `Bills ${group.map((b) => b.invoiceNumber).join(", ")} share the same date and total — worth checking for an accidental duplicate.`,
        confidence: 70,
      });
    }
  }

  if (active.length >= 2) {
    const byMonth = new Map<string, number>();
    for (const bill of active) {
      if (!bill.invoiceDate) continue;
      const month = bill.invoiceDate.slice(0, 7);
      byMonth.set(month, round2((byMonth.get(month) ?? 0) + bill.total));
    }
    const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (months.length >= 2) {
      const [, lastValue] = months[months.length - 1];
      const [, prevValue] = months[months.length - 2];
      const direction = lastValue > prevValue ? "up" : lastValue < prevValue ? "down" : "flat";
      signals.push({
        kind: "purchase-trend",
        message: `Purchasing trend with this supplier is ${direction} month-over-month (${prevValue} -> ${lastValue}).`,
        reasoning: "Compares total bill value from this supplier across the two most recent calendar months with activity.",
        confidence: 70,
      });
    }
  }

  if (supplier.riskRating !== "Low" || (active.length > 0 && overdue.length > 0)) {
    signals.push({
      kind: "supplier-risk",
      message: `Risk rating: ${supplier.riskRating}.`,
      reasoning: "Set on the supplier record; combine with the overdue-bill signal above for the fuller picture.",
      confidence: 60,
    });
  }

  return signals;
}
