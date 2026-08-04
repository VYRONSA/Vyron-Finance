import { describe, expect, it } from "vitest";
import { buildSupplierFinancialSummary, buildSupplierIntelligence, computeAveragePaymentDays, computeSupplierAging } from "./supplier-financial-service";
import type { ImportedBill, Supplier } from "@/server/accounting/types";

const SUPPLIER: Supplier = {
  id: 1, companyId: "co_1", name: "ABC Supplies", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
  supplierCode: "SUPP-1000", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "", bankBranchCode: "",
  vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30,
};

function bill(overrides: Partial<ImportedBill> & Pick<ImportedBill, "id">): ImportedBill {
  return {
    companyId: "co_1",
    supplierId: 1,
    supplierName: "ABC Supplies",
    invoiceNumber: "INV-1",
    documentType: "Bill",
    invoiceDate: "2026-06-01",
    dueDate: "2026-06-30",
    vat: 0,
    total: 1000,
    outstanding: 1000,
    status: "Open",
    glAccount: null,
    vatCode: null,
    origin: "Imported",
    purchaseOrderId: null,
    goodsReceivedNoteId: null,
    postingStatus: null,
    journalId: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    postedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe("computeSupplierAging", () => {
  it("buckets a not-yet-due bill as Current", () => {
    const result = computeSupplierAging([bill({ id: 1, dueDate: "2026-07-30", outstanding: 500 })], "2026-07-15");
    expect(result).toEqual({ current: 500, days30: 0, days60: 0, days90: 0, days120Plus: 0 });
  });

  it("buckets by days overdue at the 30/60/90/120 boundaries", () => {
    const bills = [
      bill({ id: 1, dueDate: "2026-07-01", outstanding: 100 }), // 15 days overdue -> 30-bucket
      bill({ id: 2, dueDate: "2026-06-01", outstanding: 200 }), // 45 days overdue -> 60-bucket
      bill({ id: 3, dueDate: "2026-05-01", outstanding: 300 }), // 76 days overdue -> 90-bucket
      bill({ id: 4, dueDate: "2026-01-01", outstanding: 400 }), // way over 120 -> 120+-bucket
    ];
    const result = computeSupplierAging(bills, "2026-07-16");
    expect(result).toEqual({ current: 0, days30: 100, days60: 200, days90: 300, days120Plus: 400 });
  });

  it("ignores bills that are already fully paid (outstanding <= 0)", () => {
    const result = computeSupplierAging([bill({ id: 1, dueDate: "2026-01-01", outstanding: 0 })], "2026-07-16");
    expect(result).toEqual({ current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 });
  });

  it("treats a bill with no due date as Current rather than dropping it", () => {
    const result = computeSupplierAging([bill({ id: 1, dueDate: null, outstanding: 250 })], "2026-07-16");
    expect(result.current).toBe(250);
  });
});

describe("buildSupplierFinancialSummary", () => {
  it("sums outstanding balance across open bills", () => {
    const summary = buildSupplierFinancialSummary(
      [bill({ id: 1, outstanding: 500 }), bill({ id: 2, outstanding: 300 }), bill({ id: 3, outstanding: 0 })],
      [],
      "2026-07-16",
    );
    expect(summary.outstandingBalance).toBe(800);
    expect(summary.openBillCount).toBe(2);
    expect(summary.totalBillCount).toBe(3);
  });

  it("nets Credit Notes against Bills for lifetime purchases", () => {
    const summary = buildSupplierFinancialSummary(
      [bill({ id: 1, documentType: "Bill", total: 1000 }), bill({ id: 2, documentType: "Credit Note", total: 200, outstanding: 0 })],
      [],
      "2026-07-16",
    );
    expect(summary.lifetimePurchases).toBe(800);
  });
});

describe("computeAveragePaymentDays", () => {
  it("returns null when no bill has been fully paid yet", () => {
    expect(computeAveragePaymentDays([{ id: 1, invoiceDate: "2026-06-01", outstanding: 500 }], [])).toBeNull();
  });

  it("computes days from invoice date to the last allocation date for fully-paid bills", () => {
    const result = computeAveragePaymentDays(
      [{ id: 1, invoiceDate: "2026-06-01", outstanding: 0 }],
      [{ billId: 1, allocatedAt: "2026-06-16T00:00:00Z" }],
    );
    expect(result).toBe(15);
  });

  it("averages across multiple fully-paid bills", () => {
    const result = computeAveragePaymentDays(
      [
        { id: 1, invoiceDate: "2026-06-01", outstanding: 0 },
        { id: 2, invoiceDate: "2026-06-01", outstanding: 0 },
      ],
      [
        { billId: 1, allocatedAt: "2026-06-11T00:00:00Z" }, // 10 days
        { billId: 2, allocatedAt: "2026-06-21T00:00:00Z" }, // 20 days
      ],
    );
    expect(result).toBe(15);
  });

  it("ignores bills that still have an outstanding balance", () => {
    const result = computeAveragePaymentDays(
      [
        { id: 1, invoiceDate: "2026-06-01", outstanding: 0 },
        { id: 2, invoiceDate: "2026-06-01", outstanding: 500 },
      ],
      [{ billId: 1, allocatedAt: "2026-06-11T00:00:00Z" }],
    );
    expect(result).toBe(10);
  });
});

describe("buildSupplierIntelligence", () => {
  it("flags an overdue, still-outstanding bill as payment risk with an action-needed suggestion", () => {
    const signals = buildSupplierIntelligence(SUPPLIER, [bill({ id: 1, dueDate: "2026-06-01", outstanding: 1000 })], "2026-07-01");
    expect(signals.some((s) => s.kind === "payment-risk")).toBe(true);
    expect(signals.some((s) => s.kind === "action-needed")).toBe(true);
  });

  it("does not flag a not-yet-due bill", () => {
    const signals = buildSupplierIntelligence(SUPPLIER, [bill({ id: 1, dueDate: "2026-08-01", outstanding: 1000 })], "2026-07-01");
    expect(signals.some((s) => s.kind === "payment-risk")).toBe(false);
  });

  it("flags cash flow impact for bills due within 7 days", () => {
    const signals = buildSupplierIntelligence(SUPPLIER, [bill({ id: 1, dueDate: "2026-07-05", outstanding: 500 })], "2026-07-01");
    expect(signals.some((s) => s.kind === "cash-flow-impact")).toBe(true);
  });

  it("identifies the largest bill", () => {
    const signals = buildSupplierIntelligence(SUPPLIER, [bill({ id: 1, total: 500 }), bill({ id: 2, total: 5000 })], "2026-07-01");
    const largest = signals.find((s) => s.kind === "largest-bill");
    expect(largest?.message).toContain("5000");
  });

  it("flags duplicate bills sharing the same date and total", () => {
    const signals = buildSupplierIntelligence(
      SUPPLIER,
      [bill({ id: 1, invoiceDate: "2026-06-05", total: 1000 }), bill({ id: 2, invoiceDate: "2026-06-05", total: 1000 })],
      "2026-07-01",
    );
    expect(signals.some((s) => s.kind === "duplicate-bill")).toBe(true);
  });

  it("ignores Credit Notes when computing largest-bill/average-bill-value", () => {
    const signals = buildSupplierIntelligence(
      SUPPLIER,
      [bill({ id: 1, total: 500 }), bill({ id: 2, documentType: "Credit Note", total: 5000 })],
      "2026-07-01",
    );
    const largest = signals.find((s) => s.kind === "largest-bill");
    expect(largest?.message).toContain("500");
  });

  it("returns no signals for a supplier with no bills", () => {
    expect(buildSupplierIntelligence(SUPPLIER, [], "2026-07-01")).toEqual([]);
  });
});
