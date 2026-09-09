/**
 * Customer Revenue Concentration — Phase 25C. Pure, deterministic, no AI.
 * The customer-side mirror of `executive-intelligence-service.ts::
 * detectSupplierRisk` — same share-of-total threshold (40% Medium, 60%
 * High), same "only the single top entity, or nothing" shape — applied to
 * customer revenue instead of supplier spend. Revenue itself is NOT
 * recomputed from scratch: `signedTotal` (Invoices/Debit Notes add,
 * Credit Notes net off) is the exact same per-invoice definition
 * `sales-summary-service.ts::buildSalesDashboardSummary` already uses for
 * "Top Customers," reused here rather than re-derived, so this detector
 * can never quietly disagree with the Sales workspace's own numbers.
 */

import { signedTotal } from "@/server/services/sales-summary-service";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";

export type CustomerConcentrationRisk = {
  customerId: number;
  customerName: string;
  /** Rounded to 2 decimal places, e.g. 62.5 for 62.5%. */
  sharePercent: number;
  customerRevenue: number;
  totalRevenue: number;
};

/** Same 40%/60% concentration bands `detectSupplierRisk` already uses —
 * not re-derived, just applied to the customer side. */
export const CUSTOMER_CONCENTRATION_THRESHOLD = 0.4;
export const CUSTOMER_CONCENTRATION_HIGH_THRESHOLD = 0.6;

/** Pure. Only Posted invoices count as real revenue (matches
 * `buildSalesDashboardSummary`'s own `posted` filter). Returns `null`
 * when there is no positive total revenue, or when no single customer's
 * net revenue reaches the 40% threshold — never a fabricated
 * "concentration" out of an empty or evenly-spread book. */
export function detectCustomerConcentrationRisk(customers: Customer[], invoices: SalesInvoice[]): CustomerConcentrationRisk | null {
  const posted = invoices.filter((i) => i.status === "Posted");

  const totalsByCustomer = new Map<number, number>();
  let grandTotal = 0;
  for (const invoice of posted) {
    const amount = signedTotal(invoice);
    totalsByCustomer.set(invoice.customerId, (totalsByCustomer.get(invoice.customerId) ?? 0) + amount);
    grandTotal += amount;
  }
  if (grandTotal <= 0) return null;

  let topCustomerId: number | null = null;
  let topTotal = 0;
  for (const [customerId, total] of totalsByCustomer) {
    if (total > topTotal) {
      topTotal = total;
      topCustomerId = customerId;
    }
  }
  if (topCustomerId === null) return null;

  const share = topTotal / grandTotal;
  if (share < CUSTOMER_CONCENTRATION_THRESHOLD) return null;

  const customer = customers.find((c) => c.id === topCustomerId);
  return {
    customerId: topCustomerId,
    customerName: customer?.name ?? `Customer #${topCustomerId}`,
    sharePercent: Math.round(share * 10_000) / 100,
    customerRevenue: Math.round(topTotal * 100) / 100,
    totalRevenue: Math.round(grandTotal * 100) / 100,
  };
}
