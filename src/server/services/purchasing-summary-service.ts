/**
 * Shared Purchasing summary math — the single place "Purchases Today",
 * "Outstanding Creditors", "Top Suppliers", and "Largest Bills" are
 * computed, so the Purchasing workspace and the Dashboard can never
 * quietly restate the same numbers differently. Mirrors
 * `sales-summary-service.ts`. Pure — unit tested.
 *
 * Deliberately covers EVERY bill regardless of `origin` (imported or
 * Purchasing-entered) or `postingStatus` — unlike Sales (where every
 * invoice flows through one uniform workflow), most real bill volume
 * here is likely imported and may never be individually posted through
 * the new workflow. `outstanding`/`total` are real, factual amounts
 * regardless of GL posting state, so excluding imported bills would
 * understate "Purchases Today"/"Outstanding Creditors" against reality —
 * a deliberate, disclosed difference from Sales, not an inconsistency.
 */

import type { ImportedBill, Supplier } from "@/server/accounting/types";
import type { PurchaseOrder, SupplierPayment } from "@/server/purchasing/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Bills increase what's owed, Credit Notes reduce it — same convention
 * `supplier-financial-service.ts` uses. */
function signedTotal(bill: Pick<ImportedBill, "documentType" | "total">): number {
  return bill.documentType === "Credit Note" ? -bill.total : bill.total;
}
function signedOutstanding(bill: Pick<ImportedBill, "documentType" | "outstanding">): number {
  return bill.documentType === "Credit Note" ? -bill.outstanding : bill.outstanding;
}

export type PurchasingDashboardSummary = {
  purchasesToday: number;
  billsThisMonth: number;
  outstandingCreditors: number;
  ordersAwaitingApproval: number;
  paymentsThisMonth: number;
  topSuppliers: { supplierId: number; supplierName: string; lifetimePurchases: number }[];
  largestBills: { id: number; documentNumber: string; supplierName: string; date: string; total: number }[];
};

export function buildPurchasingDashboardSummary(
  bills: ImportedBill[],
  orders: PurchaseOrder[],
  suppliers: Supplier[],
  asOfDate: string,
  payments: SupplierPayment[] = [],
  topN = 5,
): PurchasingDashboardSummary {
  const active = bills.filter((b) => b.documentType !== "Credit Note" && b.invoiceDate !== null);
  const purchasesToday = round2(active.filter((b) => b.invoiceDate === asOfDate).reduce((sum, b) => sum + b.total, 0));
  const billsThisMonth = active.filter((b) => b.invoiceDate!.slice(0, 7) === asOfDate.slice(0, 7)).length;
  const outstandingCreditors = round2(bills.reduce((sum, b) => sum + signedOutstanding(b), 0));
  const ordersAwaitingApproval = orders.filter((o) => o.status === "Submitted").length;
  const paymentsThisMonth = payments.filter((p) => p.status === "Posted" && p.paymentDate.slice(0, 7) === asOfDate.slice(0, 7)).length;

  const supplierName = (id: number | null) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;

  const purchasesBySupplier = new Map<number, number>();
  for (const bill of bills) {
    if (bill.supplierId === null) continue;
    purchasesBySupplier.set(bill.supplierId, round2((purchasesBySupplier.get(bill.supplierId) ?? 0) + signedTotal(bill)));
  }
  const topSuppliers = [...purchasesBySupplier.entries()]
    .map(([supplierId, lifetimePurchases]) => ({ supplierId, supplierName: supplierName(supplierId), lifetimePurchases }))
    .sort((a, b) => b.lifetimePurchases - a.lifetimePurchases)
    .slice(0, topN);

  const largestBills = [...active]
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map((b) => ({ id: b.id, documentNumber: b.invoiceNumber, supplierName: supplierName(b.supplierId), date: b.invoiceDate!, total: b.total }));

  return { purchasesToday, billsThisMonth, outstandingCreditors, ordersAwaitingApproval, paymentsThisMonth, topSuppliers, largestBills };
}
