import { describe, expect, it } from "vitest";
import { buildPurchasingDashboardSummary } from "./purchasing-summary-service";
import type { ImportedBill, Supplier } from "@/server/accounting/types";
import type { PurchaseOrder, SupplierPayment } from "@/server/purchasing/types";

const SUPPLIERS: Supplier[] = [
  { id: 1, companyId: "co_1", name: "Fenwick Office Supplies", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active", supplierCode: "SUPP-1", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "", bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30 },
  { id: 2, companyId: "co_1", name: "Netherfield Freight Ltd", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active", supplierCode: "SUPP-2", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "", bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30 },
];

function bill(overrides: Partial<ImportedBill> & Pick<ImportedBill, "id" | "supplierId">): ImportedBill {
  return {
    companyId: "co_1", supplierName: "", invoiceNumber: `INV${overrides.id}`, documentType: "Bill",
    invoiceDate: "2026-07-01", dueDate: "2026-07-31", vat: 150, total: 1150, outstanding: 1150,
    status: "Open", glAccount: null, vatCode: null, origin: "Imported", purchaseOrderId: null,
    goodsReceivedNoteId: null, postingStatus: null, journalId: null, submittedBy: null, submittedAt: null,
    approvedBy: null, approvedAt: null, postedAt: null, cancelledBy: null, cancelledAt: null,
    ...overrides,
  };
}

function order(overrides: Partial<PurchaseOrder> & Pick<PurchaseOrder, "id" | "supplierId">): PurchaseOrder {
  return {
    companyId: "co_1", requisitionId: null, orderNumber: `PO${overrides.id}`, orderDate: "2026-07-01", status: "Approved",
    notes: "", createdAt: "2026-07-01T00:00:00Z", lines: [],
    ...overrides,
  };
}

function payment(overrides: Partial<SupplierPayment> & Pick<SupplierPayment, "id" | "supplierId">): SupplierPayment {
  return {
    companyId: "co_1", bankAccountId: null, paymentNumber: `PAY${overrides.id}`, paymentDate: "2026-07-01", amount: 1000,
    status: "Posted", journalId: null, reference: "", notes: "", createdAt: "2026-07-01T00:00:00Z",
    approvedBy: null, approvedAt: null, postedAt: null, allocations: [],
    ...overrides,
  };
}

describe("buildPurchasingDashboardSummary", () => {
  it("sums today's non-Credit-Note bills regardless of origin or posting status", () => {
    const summary = buildPurchasingDashboardSummary(
      [
        bill({ id: 1, supplierId: 1, invoiceDate: "2026-07-15", total: 1000, origin: "Imported", postingStatus: null }),
        bill({ id: 2, supplierId: 1, invoiceDate: "2026-07-15", total: 500, origin: "Purchasing", postingStatus: "Posted" }),
        bill({ id: 3, supplierId: 1, documentType: "Credit Note", invoiceDate: "2026-07-15", total: 300 }),
        bill({ id: 4, supplierId: 1, invoiceDate: "2026-07-14", total: 2000 }),
      ],
      [],
      SUPPLIERS,
      "2026-07-15",
    );
    expect(summary.purchasesToday).toBe(1500);
  });

  it("nets Credit Notes against Bills/Debit Notes for outstanding creditors", () => {
    const summary = buildPurchasingDashboardSummary(
      [
        bill({ id: 1, supplierId: 1, total: 1000, outstanding: 1000 }),
        bill({ id: 2, supplierId: 1, documentType: "Credit Note", total: 300, outstanding: 300 }),
      ],
      [],
      SUPPLIERS,
      "2026-07-15",
    );
    expect(summary.outstandingCreditors).toBe(700);
  });

  it("counts orders awaiting approval as Submitted, not Draft or Approved", () => {
    const summary = buildPurchasingDashboardSummary(
      [],
      [order({ id: 1, supplierId: 1, status: "Submitted" }), order({ id: 2, supplierId: 1, status: "Draft" }), order({ id: 3, supplierId: 1, status: "Approved" })],
      SUPPLIERS,
      "2026-07-15",
    );
    expect(summary.ordersAwaitingApproval).toBe(1);
  });

  it("ranks top suppliers by net lifetime purchases", () => {
    const summary = buildPurchasingDashboardSummary(
      [
        bill({ id: 1, supplierId: 1, total: 500 }),
        bill({ id: 2, supplierId: 2, total: 2000 }),
        bill({ id: 3, supplierId: 1, total: 300 }),
      ],
      [],
      SUPPLIERS,
      "2026-07-15",
    );
    expect(summary.topSuppliers[0]).toEqual({ supplierId: 2, supplierName: "Netherfield Freight Ltd", lifetimePurchases: 2000 });
    expect(summary.topSuppliers[1]).toEqual({ supplierId: 1, supplierName: "Fenwick Office Supplies", lifetimePurchases: 800 });
  });

  it("excludes Credit Notes from largest bills", () => {
    const summary = buildPurchasingDashboardSummary(
      [
        bill({ id: 1, supplierId: 1, total: 500 }),
        bill({ id: 2, supplierId: 2, documentType: "Credit Note", total: 9000 }),
      ],
      [],
      SUPPLIERS,
      "2026-07-15",
    );
    expect(summary.largestBills).toHaveLength(1);
    expect(summary.largestBills[0].documentNumber).toBe("INV1");
  });

  it("counts only Posted payments made this month", () => {
    const summary = buildPurchasingDashboardSummary(
      [],
      [],
      SUPPLIERS,
      "2026-07-15",
      [
        payment({ id: 1, supplierId: 1, paymentDate: "2026-07-10", status: "Posted" }),
        payment({ id: 2, supplierId: 1, paymentDate: "2026-06-20", status: "Posted" }),
        payment({ id: 3, supplierId: 1, paymentDate: "2026-07-12", status: "Draft" }),
      ],
    );
    expect(summary.paymentsThisMonth).toBe(1);
  });

  it("returns zeros and empty lists for no purchasing activity", () => {
    const summary = buildPurchasingDashboardSummary([], [], SUPPLIERS, "2026-07-15");
    expect(summary).toEqual({
      purchasesToday: 0,
      billsThisMonth: 0,
      outstandingCreditors: 0,
      ordersAwaitingApproval: 0,
      paymentsThisMonth: 0,
      topSuppliers: [],
      largestBills: [],
    });
  });
});
