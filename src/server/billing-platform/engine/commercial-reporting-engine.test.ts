import { describe, expect, it } from "vitest";
import { computeCommercialReportingSnapshot, type SubscriptionWithPrice } from "./commercial-reporting-engine";
import type { Invoice, Payment, Subscription } from "../types";

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1", billingAccountId: "ba_1", planId: 1, billingCycle: "monthly", currencyCode: "ZAR", status: "trial",
    trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, gracePeriodEndsAt: null, cancelAtPeriodEnd: false,
    cancelledAt: null, trialWarningSentAt: null, provider: "manual", providerSubscriptionId: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...overrides,
  };
}

describe("computeCommercialReportingSnapshot", () => {
  it("reports a real zero MRR/ARR when there are no active paid subscriptions, not NotAvailable", () => {
    const result = computeCommercialReportingSnapshot([{ subscription: subscription({ status: "trial" }), unitAmount: 0 }], [], []);
    expect(result.mrr).toEqual({ value: 0, quality: "Live" });
    expect(result.arr).toEqual({ value: 0, quality: "Live" });
    expect(result.activePaidSubscriptions).toBe(0);
    expect(result.trialSubscriptions).toBe(1);
  });

  it("sums monthly-equivalent MRR across active subscriptions on different billing cycles", () => {
    const subs: SubscriptionWithPrice[] = [
      { subscription: subscription({ id: "s1", status: "active", billingCycle: "monthly" }), unitAmount: 950 },
      { subscription: subscription({ id: "s2", status: "active", billingCycle: "annual" }), unitAmount: 24480 },
    ];
    const result = computeCommercialReportingSnapshot(subs, [], []);
    expect(result.mrr.value).toBeCloseTo(950 + 24480 / 12);
    expect(result.arr.value).toBeCloseTo(result.mrr.value! * 12);
    expect(result.activePaidSubscriptions).toBe(2);
  });

  it("computes outstanding revenue from open invoices only, excluding paid/void", () => {
    const invoices: Invoice[] = [
      { id: "i1", billingAccountId: "ba_1", subscriptionId: null, invoiceNumber: "INV-1", status: "open", currencyCode: "ZAR", subtotal: 900, taxAmount: 100, total: 1000, amountPaid: 0, issuedAt: null, dueAt: null, paidAt: null, provider: "manual", providerInvoiceId: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: "i2", billingAccountId: "ba_1", subscriptionId: null, invoiceNumber: "INV-2", status: "paid", currencyCode: "ZAR", subtotal: 900, taxAmount: 100, total: 1000, amountPaid: 1000, issuedAt: null, dueAt: null, paidAt: null, provider: "manual", providerInvoiceId: null, createdAt: "2026-01-01T00:00:00Z" },
    ];
    const result = computeCommercialReportingSnapshot([], invoices, []);
    expect(result.outstandingRevenue).toEqual({ value: 1000, quality: "Live" });
  });

  it("counts failed payments", () => {
    const payments: Payment[] = [
      { id: "p1", billingAccountId: "ba_1", invoiceId: null, status: "failed", amount: 500, currencyCode: "ZAR", failureReason: "Card declined", provider: "manual", providerPaymentId: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: "p2", billingAccountId: "ba_1", invoiceId: null, status: "succeeded", amount: 500, currencyCode: "ZAR", failureReason: null, provider: "manual", providerPaymentId: null, createdAt: "2026-01-01T00:00:00Z" },
    ];
    const result = computeCommercialReportingSnapshot([], [], payments);
    expect(result.failedPaymentsCount).toBe(1);
  });

  it("marks history-dependent metrics NotAvailable, never a fabricated number", () => {
    const result = computeCommercialReportingSnapshot([], [], []);
    for (const metric of [result.trialConversionRate, result.churnRate, result.lifetimeValue, result.subscriptionGrowth]) {
      expect(metric.quality).toBe("NotAvailable");
      expect(metric.value).toBeNull();
      expect(metric.note).toBeTruthy();
    }
  });
});
