/**
 * Shared Sales summary math — the single place "Sales Today", "Invoices
 * This Month", "Outstanding Debtors", "Top Customers", and "Largest
 * Sales" are computed, so the Sales workspace and the Dashboard can never
 * quietly restate the same numbers differently. Pure — unit tested.
 */

import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice, SalesOrder } from "@/server/sales/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Invoices/Debit Notes increase what's owed, Credit Notes reduce it —
 * same convention `customer-financial-service.ts` uses. */
function signedTotal(invoice: Pick<SalesInvoice, "documentType" | "total">): number {
  return invoice.documentType === "Credit Note" ? -invoice.total : invoice.total;
}
function signedOutstanding(invoice: Pick<SalesInvoice, "documentType" | "outstanding">): number {
  return invoice.documentType === "Credit Note" ? -invoice.outstanding : invoice.outstanding;
}

export type SalesDashboardSummary = {
  salesToday: number;
  invoicesThisMonth: number;
  outstandingDebtors: number;
  openOrders: number;
  awaitingApproval: number;
  topCustomers: { customerId: number; customerName: string; lifetimeSales: number }[];
  largestSales: { id: number; documentNumber: string; customerName: string; date: string; total: number }[];
};

export function buildSalesDashboardSummary(
  invoices: SalesInvoice[],
  orders: SalesOrder[],
  customers: Customer[],
  asOfDate: string,
  topN = 5,
): SalesDashboardSummary {
  const posted = invoices.filter((i) => i.status === "Posted");
  const salesToday = round2(
    posted.filter((i) => i.documentType !== "Credit Note" && i.invoiceDate === asOfDate).reduce((sum, i) => sum + i.total, 0),
  );
  const invoicesThisMonth = posted.filter((i) => i.documentType === "Invoice" && i.invoiceDate.slice(0, 7) === asOfDate.slice(0, 7)).length;
  const outstandingDebtors = round2(posted.reduce((sum, i) => sum + signedOutstanding(i), 0));
  const openOrders = orders.filter((o) => o.status !== "Invoiced" && o.status !== "Cancelled").length;
  const awaitingApproval = invoices.filter((i) => i.status === "Submitted" || i.status === "Approved").length;

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? `Customer #${id}`;

  const salesByCustomer = new Map<number, number>();
  for (const invoice of posted) {
    salesByCustomer.set(invoice.customerId, round2((salesByCustomer.get(invoice.customerId) ?? 0) + signedTotal(invoice)));
  }
  const topCustomers = [...salesByCustomer.entries()]
    .map(([customerId, lifetimeSales]) => ({ customerId, customerName: customerName(customerId), lifetimeSales }))
    .sort((a, b) => b.lifetimeSales - a.lifetimeSales)
    .slice(0, topN);

  const largestSales = [...posted]
    .filter((i) => i.documentType !== "Credit Note")
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map((i) => ({ id: i.id, documentNumber: i.invoiceNumber, customerName: customerName(i.customerId), date: i.invoiceDate, total: i.total }));

  return { salesToday, invoicesThisMonth, outstandingDebtors, openOrders, awaitingApproval, topCustomers, largestSales };
}
