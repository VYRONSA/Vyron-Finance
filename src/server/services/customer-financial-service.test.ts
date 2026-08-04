import { describe, expect, it } from "vitest";
import { buildCustomerIntelligence, computeAveragePaymentDays } from "./customer-financial-service";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";

const CUSTOMER: Customer = {
  id: 1, companyId: "co_1", customerCode: "CUST-1000", name: "Meridian Traders", customerType: "Company",
  customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit: 10000, paymentTermsDays: 30,
  currencyCode: null, priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2026-01-01T00:00:00Z",
};

function invoice(overrides: Partial<SalesInvoice> & Pick<SalesInvoice, "id">): Pick<SalesInvoice, "id" | "invoiceNumber" | "documentType" | "invoiceDate" | "dueDate" | "total" | "outstanding" | "status"> {
  return {
    invoiceNumber: `INV${overrides.id}`,
    documentType: "Invoice",
    invoiceDate: "2026-06-01",
    dueDate: "2026-06-30",
    total: 1000,
    outstanding: 1000,
    status: "Posted",
    ...overrides,
  };
}

describe("computeAveragePaymentDays", () => {
  it("returns null when no invoice has been fully paid yet", () => {
    expect(computeAveragePaymentDays([{ id: 1, invoiceDate: "2026-06-01", outstanding: 500 }], [])).toBeNull();
  });

  it("computes days from invoice date to the last allocation date for fully-paid invoices", () => {
    const result = computeAveragePaymentDays(
      [{ id: 1, invoiceDate: "2026-06-01", outstanding: 0 }],
      [{ invoiceId: 1, allocatedAt: "2026-06-16T00:00:00Z" }],
    );
    expect(result).toBe(15);
  });

  it("averages across multiple fully-paid invoices", () => {
    const result = computeAveragePaymentDays(
      [
        { id: 1, invoiceDate: "2026-06-01", outstanding: 0 },
        { id: 2, invoiceDate: "2026-06-01", outstanding: 0 },
      ],
      [
        { invoiceId: 1, allocatedAt: "2026-06-11T00:00:00Z" }, // 10 days
        { invoiceId: 2, allocatedAt: "2026-06-21T00:00:00Z" }, // 20 days
      ],
    );
    expect(result).toBe(15);
  });

  it("ignores invoices that still have an outstanding balance", () => {
    const result = computeAveragePaymentDays(
      [
        { id: 1, invoiceDate: "2026-06-01", outstanding: 0 },
        { id: 2, invoiceDate: "2026-06-01", outstanding: 500 },
      ],
      [{ invoiceId: 1, allocatedAt: "2026-06-11T00:00:00Z" }],
    );
    expect(result).toBe(10);
  });

  it("uses the LAST allocation date for a partially-then-fully-paid invoice", () => {
    const result = computeAveragePaymentDays(
      [{ id: 1, invoiceDate: "2026-06-01", outstanding: 0 }],
      [
        { invoiceId: 1, allocatedAt: "2026-06-05T00:00:00Z" },
        { invoiceId: 1, allocatedAt: "2026-06-21T00:00:00Z" },
      ],
    );
    expect(result).toBe(20);
  });
});

describe("buildCustomerIntelligence", () => {
  it("flags an overdue, still-outstanding invoice as late-payment risk with a follow-up suggestion", () => {
    const signals = buildCustomerIntelligence(CUSTOMER, [invoice({ id: 1, dueDate: "2026-06-01", outstanding: 1000 })], "2026-07-01");
    expect(signals.some((s) => s.kind === "late-payment-risk")).toBe(true);
    expect(signals.some((s) => s.kind === "follow-up")).toBe(true);
  });

  it("does not flag a not-yet-due invoice", () => {
    const signals = buildCustomerIntelligence(CUSTOMER, [invoice({ id: 1, dueDate: "2026-08-01", outstanding: 1000 })], "2026-07-01");
    expect(signals.some((s) => s.kind === "late-payment-risk")).toBe(false);
  });

  it("identifies the largest posted invoice", () => {
    const signals = buildCustomerIntelligence(
      CUSTOMER,
      [invoice({ id: 1, total: 500 }), invoice({ id: 2, total: 5000 })],
      "2026-07-01",
    );
    const largest = signals.find((s) => s.kind === "largest-purchase");
    expect(largest?.message).toContain("5000");
  });

  it("flags duplicate invoices sharing the same date and total", () => {
    const signals = buildCustomerIntelligence(
      CUSTOMER,
      [invoice({ id: 1, invoiceDate: "2026-06-05", total: 1000 }), invoice({ id: 2, invoiceDate: "2026-06-05", total: 1000 })],
      "2026-07-01",
    );
    expect(signals.some((s) => s.kind === "duplicate-invoice")).toBe(true);
  });

  it("does not flag invoices with different dates or amounts as duplicates", () => {
    const signals = buildCustomerIntelligence(
      CUSTOMER,
      [invoice({ id: 1, invoiceDate: "2026-06-05", total: 1000 }), invoice({ id: 2, invoiceDate: "2026-06-06", total: 1000 })],
      "2026-07-01",
    );
    expect(signals.some((s) => s.kind === "duplicate-invoice")).toBe(false);
  });

  it("ignores Credit Notes when computing largest-purchase/average-order-value", () => {
    const signals = buildCustomerIntelligence(
      CUSTOMER,
      [invoice({ id: 1, total: 500 }), invoice({ id: 2, documentType: "Credit Note", total: 5000 })],
      "2026-07-01",
    );
    const largest = signals.find((s) => s.kind === "largest-purchase");
    expect(largest?.message).toContain("500");
  });

  it("returns no signals for a customer with no posted invoices", () => {
    expect(buildCustomerIntelligence(CUSTOMER, [], "2026-07-01")).toEqual([]);
  });
});
