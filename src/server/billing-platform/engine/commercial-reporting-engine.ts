/**
 * Commercial Reporting — Internal Billing Console's Revenue
 * Intelligence tab. "No fabricated values. If insufficient data exists,
 * clearly show 'No production data yet.'" Every metric below is either
 * a real computation over real current data (MRR/ARR/ARPC/Outstanding
 * Revenue/Failed Payments/active-subscription counts — all correctly
 * `0` when there's genuinely nothing yet, a real zero, not a missing
 * value) or explicitly `NotAvailable` (Trial Conversion/Churn/Lifetime
 * Value/Subscription Growth — these need period-over-period historical
 * snapshots this platform doesn't build yet; marking them fabricated
 * "0%" would be worse than honestly admitting they're not computed).
 */

import type { Invoice, Payment, Subscription } from "../types";

export type RevenueMetricQuality = "Live" | "NotAvailable";
export type RevenueMetric = { value: number | null; quality: RevenueMetricQuality; note?: string };

export type CommercialReportingSnapshot = {
  mrr: RevenueMetric;
  arr: RevenueMetric;
  activePaidSubscriptions: number;
  trialSubscriptions: number;
  averageRevenuePerCustomer: RevenueMetric;
  outstandingRevenue: RevenueMetric;
  failedPaymentsCount: number;
  trialConversionRate: RevenueMetric;
  churnRate: RevenueMetric;
  lifetimeValue: RevenueMetric;
  subscriptionGrowth: RevenueMetric;
};

const NOT_AVAILABLE = (note: string): RevenueMetric => ({ value: null, quality: "NotAvailable", note });

function monthlyEquivalent(unitAmount: number, billingCycle: Subscription["billingCycle"]): number {
  if (billingCycle === "annual") return unitAmount / 12;
  if (billingCycle === "quarterly") return unitAmount / 3;
  return unitAmount; // monthly, or custom treated as its own stated amount
}

export type SubscriptionWithPrice = { subscription: Subscription; unitAmount: number | null };

/** Pure — independently unit-tested. `subscriptionsWithPrices` already
 * has each subscription's own current price resolved by the caller
 * (a plan/cycle lookup, I/O, doesn't belong in a pure function). */
export function computeCommercialReportingSnapshot(subscriptionsWithPrices: SubscriptionWithPrice[], invoices: Invoice[], payments: Payment[]): CommercialReportingSnapshot {
  const active = subscriptionsWithPrices.filter((s) => s.subscription.status === "active");
  const trials = subscriptionsWithPrices.filter((s) => s.subscription.status === "trial");

  const mrrValue = active.reduce((sum, s) => sum + (s.unitAmount !== null ? monthlyEquivalent(s.unitAmount, s.subscription.billingCycle) : 0), 0);
  const mrr: RevenueMetric = { value: mrrValue, quality: "Live" };
  const arr: RevenueMetric = { value: mrrValue * 12, quality: "Live" };

  const averageRevenuePerCustomer: RevenueMetric = active.length > 0 ? { value: mrrValue / active.length, quality: "Live" } : NOT_AVAILABLE("No active paid subscriptions yet.");

  const outstandingValue = invoices.filter((i) => i.status === "open").reduce((sum, i) => sum + (i.total - i.amountPaid), 0);
  const outstandingRevenue: RevenueMetric = { value: outstandingValue, quality: "Live" };

  const failedPaymentsCount = payments.filter((p) => p.status === "failed").length;

  return {
    mrr,
    arr,
    activePaidSubscriptions: active.length,
    trialSubscriptions: trials.length,
    averageRevenuePerCustomer,
    outstandingRevenue,
    failedPaymentsCount,
    trialConversionRate: NOT_AVAILABLE("Requires period-over-period trial-outcome history, not yet tracked."),
    churnRate: NOT_AVAILABLE("Requires period-over-period subscription history, not yet tracked."),
    lifetimeValue: NOT_AVAILABLE("Requires historical payment history spanning a full customer lifecycle."),
    subscriptionGrowth: NOT_AVAILABLE("Requires period-over-period subscription-count history, not yet tracked."),
  };
}
