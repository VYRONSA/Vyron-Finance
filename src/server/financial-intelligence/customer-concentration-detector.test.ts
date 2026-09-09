import { describe, expect, it } from "vitest";
import { detectCustomerConcentrationRisk } from "./customer-concentration-detector";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1, companyId: "company-a", customerCode: "CUST-001", name: "Northwood Ltd", customerType: "Company",
    customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit: 0, paymentTermsDays: 30,
    currencyCode: "ZAR", priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "company-a", customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "INV1",
    documentType: "Invoice", invoiceDate: "2026-06-01", dueDate: "2026-06-15", vatTreatmentCode: "",
    status: "Posted", journalId: null, subtotal: 100, vatAmount: 0, total: 100, outstanding: 100,
    isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "", createdAt: "2026-06-01T00:00:00Z",
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedAt: null,
    cancelledBy: null, cancelledAt: null, originalInvoiceId: null, lines: [],
    ...overrides,
  };
}

describe("detectCustomerConcentrationRisk", () => {
  it("flags 100% concentration when there is only one customer (edge case 1)", () => {
    const result = detectCustomerConcentrationRisk([customer({ id: 1, name: "Solo Client" })], [invoice({ id: 1, customerId: 1, total: 1000 })]);
    expect(result).not.toBeNull();
    expect(result!.customerId).toBe(1);
    expect(result!.customerName).toBe("Solo Client");
    expect(result!.sharePercent).toBe(100);
    expect(result!.customerRevenue).toBe(1000);
    expect(result!.totalRevenue).toBe(1000);
  });

  it("flags the top customer when two customers exist and one is above 40% (edge case 2)", () => {
    const customers = [customer({ id: 1, name: "Big Client" }), customer({ id: 2, name: "Small Client" })];
    const invoices = [invoice({ id: 1, customerId: 1, total: 700 }), invoice({ id: 2, customerId: 2, total: 300 })];
    const result = detectCustomerConcentrationRisk(customers, invoices);
    expect(result).not.toBeNull();
    expect(result!.customerId).toBe(1);
    expect(result!.sharePercent).toBe(70);
  });

  it("flags nothing when no single customer reaches 40% (edge case 3 — with only 2 revenue sources one must exceed 40%, so this uses 3)", () => {
    const customers = [customer({ id: 1 }), customer({ id: 2, name: "B" }), customer({ id: 3, name: "C" })];
    const invoices = [
      invoice({ id: 1, customerId: 1, total: 350 }),
      invoice({ id: 2, customerId: 2, total: 350 }),
      invoice({ id: 3, customerId: 3, total: 300 }),
    ];
    expect(detectCustomerConcentrationRisk(customers, invoices)).toBeNull();
  });

  it("flags nothing when revenue is evenly distributed across many customers (edge case 4)", () => {
    const customers = Array.from({ length: 10 }, (_, i) => customer({ id: i + 1, name: `Customer ${i + 1}` }));
    const invoices = customers.map((c) => invoice({ id: c.id, customerId: c.id, total: 100 }));
    expect(detectCustomerConcentrationRisk(customers, invoices)).toBeNull();
  });

  it("nets Credit Notes against the customer's revenue, matching sales-summary-service's own signedTotal (edge case 5)", () => {
    const customers = [customer({ id: 1, name: "Refunded Client" }), customer({ id: 2, name: "Other" })];
    const invoices = [
      invoice({ id: 1, customerId: 1, documentType: "Invoice", total: 1000 }),
      invoice({ id: 2, customerId: 1, documentType: "Credit Note", total: 400 }), // nets to 600
      invoice({ id: 3, customerId: 2, total: 300 }),
    ];
    // Customer 1 net = 600, Customer 2 = 300, grand total = 900 -> 600/900 = 66.67%
    const result = detectCustomerConcentrationRisk(customers, invoices);
    expect(result).not.toBeNull();
    expect(result!.customerId).toBe(1);
    expect(result!.customerRevenue).toBe(600);
    expect(result!.sharePercent).toBeCloseTo(66.67, 1);
  });

  it("produces no fabricated concentration when there is no revenue at all (edge case 6)", () => {
    expect(detectCustomerConcentrationRisk([customer()], [])).toBeNull();
  });

  it("produces no fabricated concentration when total net revenue is zero or negative (edge case 6b)", () => {
    const customers = [customer({ id: 1 })];
    const invoices = [
      invoice({ id: 1, customerId: 1, documentType: "Invoice", total: 500 }),
      invoice({ id: 2, customerId: 1, documentType: "Credit Note", total: 500 }),
    ];
    expect(detectCustomerConcentrationRisk(customers, invoices)).toBeNull();
  });

  it("falls back to a synthetic label when the invoice's customerId has no matching Customer record — never a fabricated concentration silently dropped (edge case 7)", () => {
    const result = detectCustomerConcentrationRisk([], [invoice({ id: 1, customerId: 999, total: 1000 })]);
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Customer #999");
  });

  it("only considers the invoices it is given — a caller passing another company's data would leak into the result (multiple companies, edge case 8, proven at the pure-function boundary)", () => {
    const companyACustomers = [customer({ id: 1, companyId: "company-a", name: "A Client" })];
    const companyAInvoices = [invoice({ id: 1, companyId: "company-a", customerId: 1, total: 1000 })];
    const resultA = detectCustomerConcentrationRisk(companyACustomers, companyAInvoices);
    expect(resultA!.customerName).toBe("A Client");

    const companyBCustomers = [customer({ id: 1, companyId: "company-b", name: "B Client" })];
    const companyBInvoices = [invoice({ id: 1, companyId: "company-b", customerId: 1, total: 2000 })];
    const resultB = detectCustomerConcentrationRisk(companyBCustomers, companyBInvoices);
    expect(resultB!.customerName).toBe("B Client");
    expect(resultB!.customerRevenue).toBe(2000);
  });

  it("flags exactly at the 40% threshold boundary (edge case 9)", () => {
    const customers = [customer({ id: 1 }), customer({ id: 2 }), customer({ id: 3 })];
    const invoices = [
      invoice({ id: 1, customerId: 1, total: 400 }), // exactly 40%, and the top customer
      invoice({ id: 2, customerId: 2, total: 300 }),
      invoice({ id: 3, customerId: 3, total: 300 }),
    ];
    const result = detectCustomerConcentrationRisk(customers, invoices);
    expect(result).not.toBeNull();
    expect(result!.customerId).toBe(1);
    expect(result!.sharePercent).toBe(40);
  });

  it("does not flag just below the 40% threshold (edge case 10)", () => {
    const customers = [customer({ id: 1 }), customer({ id: 2 }), customer({ id: 3 })];
    const invoices = [
      invoice({ id: 1, customerId: 1, total: 399 }), // just below 40%, and still the top customer
      invoice({ id: 2, customerId: 2, total: 301 }),
      invoice({ id: 3, customerId: 3, total: 300 }),
    ];
    expect(detectCustomerConcentrationRisk(customers, invoices)).toBeNull();
  });

  it("ignores non-Posted invoices, matching buildSalesDashboardSummary's own posted-only filter", () => {
    const customers = [customer({ id: 1 })];
    const invoices = [invoice({ id: 1, customerId: 1, total: 1000, status: "Draft" })];
    expect(detectCustomerConcentrationRisk(customers, invoices)).toBeNull();
  });

  it("is a pure function that never mutates its inputs", () => {
    const customers = [customer({ id: 1 })];
    const invoices = [invoice({ id: 1, customerId: 1, total: 1000 })];
    const customersSnapshot = JSON.parse(JSON.stringify(customers));
    const invoicesSnapshot = JSON.parse(JSON.stringify(invoices));
    detectCustomerConcentrationRisk(customers, invoices);
    expect(customers).toEqual(customersSnapshot);
    expect(invoices).toEqual(invoicesSnapshot);
  });
});
