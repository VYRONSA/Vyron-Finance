import { describe, expect, it } from "vitest";
import { buildSalesDashboardSummary } from "./sales-summary-service";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice, SalesOrder } from "@/server/sales/types";

const CUSTOMERS: Customer[] = [
  { id: 1, companyId: "co_1", customerCode: "CUST-1", name: "Meridian Traders", customerType: "Company", customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit: 10000, paymentTermsDays: 30, currencyCode: null, priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, companyId: "co_1", customerCode: "CUST-2", name: "Bramwell Dental", customerType: "Company", customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit: 5000, paymentTermsDays: 30, currencyCode: null, priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2026-01-01T00:00:00Z" },
];

function invoice(overrides: Partial<SalesInvoice> & Pick<SalesInvoice, "id" | "customerId">): SalesInvoice {
  return {
    companyId: "co_1", orderId: null, deliveryId: null, invoiceNumber: `INV${overrides.id}`, documentType: "Invoice",
    invoiceDate: "2026-07-01", dueDate: "2026-07-31", vatTreatmentCode: "Standard Rated", status: "Posted", journalId: null,
    subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 1150, isRecurringTemplate: false, recurrencePattern: "",
    reference: "", notes: "", createdAt: "2026-07-01T00:00:00Z", submittedBy: null, submittedAt: null, approvedBy: null,
    approvedAt: null, postedAt: null, cancelledBy: null, cancelledAt: null, lines: [],
    ...overrides,
  };
}

function order(overrides: Partial<SalesOrder> & Pick<SalesOrder, "id" | "customerId">): SalesOrder {
  return {
    companyId: "co_1", quotationId: null, orderNumber: `SO${overrides.id}`, orderDate: "2026-07-01", status: "Confirmed",
    notes: "", createdAt: "2026-07-01T00:00:00Z", lines: [],
    ...overrides,
  };
}

describe("buildSalesDashboardSummary", () => {
  it("sums today's Posted invoices/debit notes, excluding Credit Notes", () => {
    const summary = buildSalesDashboardSummary(
      [
        invoice({ id: 1, customerId: 1, invoiceDate: "2026-07-15", total: 1000 }),
        invoice({ id: 2, customerId: 1, documentType: "Credit Note", invoiceDate: "2026-07-15", total: 500 }),
        invoice({ id: 3, customerId: 1, invoiceDate: "2026-07-14", total: 2000 }),
      ],
      [],
      CUSTOMERS,
      "2026-07-15",
    );
    expect(summary.salesToday).toBe(1000);
  });

  it("counts only Posted Invoices (not Credit/Debit Notes) issued this month", () => {
    const summary = buildSalesDashboardSummary(
      [
        invoice({ id: 1, customerId: 1, invoiceDate: "2026-07-05" }),
        invoice({ id: 2, customerId: 1, documentType: "Debit Note", invoiceDate: "2026-07-06" }),
        invoice({ id: 3, customerId: 1, invoiceDate: "2026-06-20" }),
        invoice({ id: 4, customerId: 1, invoiceDate: "2026-07-10", status: "Draft" }),
      ],
      [],
      CUSTOMERS,
      "2026-07-15",
    );
    expect(summary.invoicesThisMonth).toBe(1);
  });

  it("nets Credit Notes against Invoices/Debit Notes for outstanding debtors", () => {
    const summary = buildSalesDashboardSummary(
      [
        invoice({ id: 1, customerId: 1, total: 1000, outstanding: 1000 }),
        invoice({ id: 2, customerId: 1, documentType: "Credit Note", total: 300, outstanding: 300 }),
      ],
      [],
      CUSTOMERS,
      "2026-07-15",
    );
    expect(summary.outstandingDebtors).toBe(700);
  });

  it("counts open orders as anything not Invoiced or Cancelled", () => {
    const summary = buildSalesDashboardSummary(
      [],
      [order({ id: 1, customerId: 1, status: "Confirmed" }), order({ id: 2, customerId: 1, status: "Invoiced" }), order({ id: 3, customerId: 1, status: "Cancelled" })],
      CUSTOMERS,
      "2026-07-15",
    );
    expect(summary.openOrders).toBe(1);
  });

  it("ranks top customers by net lifetime Posted sales", () => {
    const summary = buildSalesDashboardSummary(
      [
        invoice({ id: 1, customerId: 1, total: 500 }),
        invoice({ id: 2, customerId: 2, total: 2000 }),
        invoice({ id: 3, customerId: 1, total: 300 }),
      ],
      [],
      CUSTOMERS,
      "2026-07-15",
    );
    expect(summary.topCustomers[0]).toEqual({ customerId: 2, customerName: "Bramwell Dental", lifetimeSales: 2000 });
    expect(summary.topCustomers[1]).toEqual({ customerId: 1, customerName: "Meridian Traders", lifetimeSales: 800 });
  });

  it("excludes Credit Notes from largest sales", () => {
    const summary = buildSalesDashboardSummary(
      [
        invoice({ id: 1, customerId: 1, total: 500 }),
        invoice({ id: 2, customerId: 2, documentType: "Credit Note", total: 9000 }),
      ],
      [],
      CUSTOMERS,
      "2026-07-15",
    );
    expect(summary.largestSales).toHaveLength(1);
    expect(summary.largestSales[0].documentNumber).toBe("INV1");
  });

  it("returns zeros and empty lists for no sales activity", () => {
    const summary = buildSalesDashboardSummary([], [], CUSTOMERS, "2026-07-15");
    expect(summary).toEqual({
      salesToday: 0,
      invoicesThisMonth: 0,
      outstandingDebtors: 0,
      openOrders: 0,
      awaitingApproval: 0,
      topCustomers: [],
      largestSales: [],
    });
  });
});
