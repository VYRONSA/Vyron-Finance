/**
 * Customer Financial Information and Customer Intelligence — now REAL,
 * computed from the Sales Platform (Commercial Platform Module 3):
 * `sales_invoices` (Invoice/Credit Note/Debit Note) and
 * `customer_receipts`. Before Sales existed this was an honest
 * `{ available: false, reason }` stub (see git history / prior
 * completion reports) — the Product Review Board's own adopted
 * principle ("no module may invent information simply because another
 * module has not yet been built... display Pending, never fabricate")
 * is why that stub existed, and why it's now replaced with real numbers
 * rather than the two being left to silently diverge.
 *
 * Gross Profit/Margin remain honestly unavailable even now — they need
 * cost data from the not-yet-built Inventory module, so those two fields
 * alone stay `null` within an otherwise-real summary (field-level
 * honesty, not whole-module pending, since most of the summary IS real).
 */

import * as invoiceRepo from "@/server/repositories/sales-invoice-repository";
import * as receiptRepo from "@/server/repositories/customer-receipt-repository";
import * as quotationRepo from "@/server/repositories/quotation-repository";
import * as orderRepo from "@/server/repositories/sales-order-repository";
import { computeAgingBuckets, type AgingBuckets } from "@/server/shared/aging";
import type { Customer } from "@/server/customer-management/types";
import type { CustomerReceipt, Quotation, SalesInvoice, SalesOrder } from "@/server/sales/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Invoices/Debit Notes increase what's owed, Credit Notes reduce it —
 * same netting convention `supplier-financial-service.ts` established for
 * Bills vs. Credit Notes. */
function signedTotal(invoice: Pick<SalesInvoice, "documentType" | "total">): number {
  return invoice.documentType === "Credit Note" ? -invoice.total : invoice.total;
}
function signedOutstanding(invoice: Pick<SalesInvoice, "documentType" | "outstanding">): number {
  return invoice.documentType === "Credit Note" ? -invoice.outstanding : invoice.outstanding;
}

export type CustomerFinancialSummary = {
  outstandingBalance: number;
  aging: AgingBuckets;
  averagePaymentDays: number | null;
  lifetimeSales: number;
  grossProfit: number | null;
  marginPercent: number | null;
  openQuotes: number;
  openOrders: number;
  openInvoices: number;
  availableCredit: number;
  creditUtilisationPercent: number;
};

/** Pure — unit tested. The real orchestration, shared by both the live
 * (Supabase-backed) path and Preview Mode, so the two can never quietly
 * diverge — Preview Mode calls this directly with its own mock arrays
 * instead of re-deriving the same aggregation separately. */
export function buildCustomerFinancialSummary(
  customer: Customer,
  invoices: SalesInvoice[],
  receipts: CustomerReceipt[],
  quotations: Quotation[],
  orders: SalesOrder[],
  asOfDate: string,
): CustomerFinancialSummary {
  const postedDocuments = invoices.filter((i) => i.status === "Posted");
  const outstandingBalance = round2(postedDocuments.reduce((sum, i) => sum + signedOutstanding(i), 0));
  const lifetimeSales = round2(postedDocuments.reduce((sum, i) => sum + signedTotal(i), 0));
  const openInvoices = postedDocuments.filter((i) => i.documentType !== "Credit Note" && i.outstanding > 0).length;

  const aging = computeAgingBuckets(postedDocuments.filter((i) => i.documentType !== "Credit Note"), asOfDate);

  const averagePaymentDays = computeAveragePaymentDays(
    postedDocuments,
    receipts.flatMap((r) => r.allocations.map((a) => ({ invoiceId: a.invoiceId, allocatedAt: a.createdAt }))),
  );

  const openQuotes = quotations.filter((q) => q.customerId === customer.id && (q.status === "Draft" || q.status === "Sent")).length;
  const openOrders = orders.filter((o) => o.customerId === customer.id && o.status !== "Invoiced" && o.status !== "Cancelled").length;

  const availableCredit = round2(customer.creditLimit - outstandingBalance);
  const creditUtilisationPercent = customer.creditLimit > 0 ? round2((outstandingBalance / customer.creditLimit) * 100) : 0;

  return {
    outstandingBalance,
    aging,
    averagePaymentDays,
    lifetimeSales,
    grossProfit: null,
    marginPercent: null,
    openQuotes,
    openOrders,
    openInvoices,
    availableCredit,
    creditUtilisationPercent,
  };
}

export async function getCustomerFinancialSummary(companyId: string, customer: Customer): Promise<CustomerFinancialSummary> {
  const [invoices, receipts, quotations, orders] = await Promise.all([
    invoiceRepo.listSalesInvoicesByCustomer(companyId, customer.id),
    receiptRepo.listCustomerReceiptsByCustomer(companyId, customer.id),
    quotationRepo.listQuotations(companyId),
    orderRepo.listSalesOrders(companyId),
  ]);

  return buildCustomerFinancialSummary(customer, invoices, receipts, quotations, orders, new Date().toISOString().slice(0, 10));
}

/** Pure — unit tested. For every invoice that's been fully paid off
 * (outstanding === 0, at least one allocation recorded against it), days
 * to pay = its last allocation date minus its invoice date. Returns
 * `null` (not 0) when there's no fully-paid invoice yet — an honest "not
 * enough data", not a fabricated "customer pays instantly." */
export function computeAveragePaymentDays(
  invoices: Pick<SalesInvoice, "id" | "invoiceDate" | "outstanding">[],
  allocations: { invoiceId: number; allocatedAt: string }[],
): number | null {
  const lastAllocationByInvoice = new Map<number, string>();
  for (const a of allocations) {
    const existing = lastAllocationByInvoice.get(a.invoiceId);
    if (!existing || a.allocatedAt > existing) lastAllocationByInvoice.set(a.invoiceId, a.allocatedAt);
  }

  const daysToPay: number[] = [];
  for (const invoice of invoices) {
    if (invoice.outstanding > 0) continue;
    const lastAllocation = lastAllocationByInvoice.get(invoice.id);
    if (!lastAllocation) continue;
    const days = Math.round((Date.parse(lastAllocation) - Date.parse(invoice.invoiceDate)) / 86_400_000);
    daysToPay.push(Math.max(days, 0));
  }

  if (daysToPay.length === 0) return null;
  return Math.round(daysToPay.reduce((sum, d) => sum + d, 0) / daysToPay.length);
}

// ---------------------------------------------------------------------
// Customer Intelligence — real, computed signals, explicitly not AI/ML
// (same honest framing as Financial Intelligence's own module docstring).
// ---------------------------------------------------------------------

export type CustomerIntelligenceSignal = {
  kind:
    | "payment-behaviour"
    | "late-payment-risk"
    | "largest-purchase"
    | "buying-trend"
    | "average-order-value"
    | "follow-up"
    | "duplicate-invoice";
  message: string;
  reasoning: string;
  confidence: number;
};

/** Pure — unit tested. Every signal is a plain computed fact with a
 * `confidence` reflecting how directly it's derived (100 for a hard
 * count/sum, lower for a heuristic threshold-based read) — not a machine
 * learning score. */
export function buildCustomerIntelligence(
  customer: Customer,
  invoices: Pick<SalesInvoice, "id" | "invoiceNumber" | "documentType" | "invoiceDate" | "dueDate" | "total" | "outstanding" | "status">[],
  todayIso: string,
): CustomerIntelligenceSignal[] {
  const signals: CustomerIntelligenceSignal[] = [];
  const posted = invoices.filter((i) => i.status === "Posted" && i.documentType !== "Credit Note");
  const today = Date.parse(todayIso);

  const overdue = posted.filter((i) => i.outstanding > 0 && i.dueDate && Date.parse(i.dueDate) < today);
  if (overdue.length > 0) {
    const totalOverdue = round2(overdue.reduce((sum, i) => sum + i.outstanding, 0));
    signals.push({
      kind: "late-payment-risk",
      message: `${overdue.length} overdue invoice(s) totalling ${totalOverdue}.`,
      reasoning: `${customer.name} has ${overdue.length} Posted invoice(s) past their due date with a balance still outstanding.`,
      confidence: 100,
    });
    signals.push({
      kind: "follow-up",
      message: `Follow up on ${overdue.length} overdue invoice(s).`,
      reasoning: "Recommended because at least one invoice is both overdue and still unpaid.",
      confidence: 90,
    });
  }

  if (posted.length > 0) {
    const largest = [...posted].sort((a, b) => b.total - a.total)[0];
    signals.push({
      kind: "largest-purchase",
      message: `Largest invoice: ${largest.invoiceNumber} (${largest.total}).`,
      reasoning: "The single largest Posted invoice for this customer, by total.",
      confidence: 100,
    });

    const averageOrderValue = round2(posted.reduce((sum, i) => sum + i.total, 0) / posted.length);
    signals.push({
      kind: "average-order-value",
      message: `Average invoice value: ${averageOrderValue}.`,
      reasoning: `Computed across ${posted.length} Posted invoice(s).`,
      confidence: 100,
    });
  }

  // Same account+date+amount pattern the Financial Intelligence engine
  // uses for duplicate journals — here, duplicate invoices.
  const groups = new Map<string, typeof posted>();
  for (const invoice of posted) {
    const key = `${invoice.invoiceDate}|${invoice.total}`;
    const group = groups.get(key) ?? [];
    group.push(invoice);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      signals.push({
        kind: "duplicate-invoice",
        message: `${group.length} invoices dated ${group[0].invoiceDate} for the same amount (${group[0].total}).`,
        reasoning: `Invoices ${group.map((i) => i.invoiceNumber).join(", ")} share the same date and total — worth checking for an accidental duplicate.`,
        confidence: 70,
      });
    }
  }

  if (posted.length >= 2) {
    const byMonth = new Map<string, number>();
    for (const invoice of posted) {
      const month = invoice.invoiceDate.slice(0, 7);
      byMonth.set(month, round2((byMonth.get(month) ?? 0) + invoice.total));
    }
    const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (months.length >= 2) {
      const [, lastValue] = months[months.length - 1];
      const [, prevValue] = months[months.length - 2];
      const direction = lastValue > prevValue ? "up" : lastValue < prevValue ? "down" : "flat";
      signals.push({
        kind: "buying-trend",
        message: `Purchasing trend is ${direction} month-over-month (${prevValue} -> ${lastValue}).`,
        reasoning: "Compares this customer's total Posted invoice value across the two most recent calendar months with activity.",
        confidence: 70,
      });
    }
  }

  if (customer.riskRating !== "Low" || (customer.creditLimit > 0 && posted.length > 0)) {
    signals.push({
      kind: "payment-behaviour",
      message: `Risk rating: ${customer.riskRating}.`,
      reasoning: `Set on the customer record; combine with the overdue-invoice signal above for the fuller picture.`,
      confidence: 60,
    });
  }

  return signals;
}
