/**
 * Phase 33A — `mergeService.mergeSuppliers` soft-deactivates the
 * duplicate supplier (`status: "Inactive"`), but `listSuppliers` returns
 * every supplier regardless of status. Without the fix under test here,
 * a just-merged duplicate would keep matching its survivor's name
 * forever — Duplicate Detection would never stop reporting a pair that
 * has already been resolved, directly contradicting Phase 33A's own
 * requirement that "the duplicate pair should no longer continue
 * appearing as an active duplicate."
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/services/customer-service", () => ({ listCustomers: vi.fn() }));
vi.mock("@/server/services/supplier-management-service", () => ({ listSuppliers: vi.fn() }));
vi.mock("@/server/services/merchant-service", () => ({ listMerchants: vi.fn() }));
vi.mock("@/server/services/stock-item-service", () => ({ listStockItems: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", () => ({ listTransactionsForExport: vi.fn() }));
vi.mock("@/server/services/sales-order-service", () => ({ listSalesOrders: vi.fn() }));
vi.mock("@/server/services/purchase-order-service", () => ({ listPurchaseOrders: vi.fn() }));
vi.mock("@/server/services/quotation-service", () => ({ listQuotations: vi.fn() }));
vi.mock("@/server/services/purchase-bill-service", () => ({ listAllBills: vi.fn() }));
vi.mock("@/server/services/supplier-payment-service", () => ({ listSupplierPayments: vi.fn() }));
vi.mock("@/server/services/customer-receipt-service", () => ({ listCustomerReceipts: vi.fn() }));
vi.mock("@/server/repositories/gl-repository", () => ({ listGlTransactionsInRange: vi.fn() }));
vi.mock("@/server/repositories/matching-override-repository", () => ({ recordOverride: vi.fn(), listRecentOverrides: vi.fn() }));

import { getDuplicateFindings } from "./duplicate-detection-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listCustomers } from "@/server/services/customer-service";
import { listMerchants } from "@/server/services/merchant-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import { listSalesOrders } from "@/server/services/sales-order-service";
import { listPurchaseOrders } from "@/server/services/purchase-order-service";
import { listQuotations } from "@/server/services/quotation-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listSupplierPayments } from "@/server/services/supplier-payment-service";
import { listCustomerReceipts } from "@/server/services/customer-receipt-service";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { listRecentOverrides } from "@/server/repositories/matching-override-repository";
import type { Supplier } from "@/server/accounting/types";

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 1, companyId: "co_1", name: "Acme Supplies", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null,
    status: "Active", supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listCustomers).mockReset().mockResolvedValue([]);
  vi.mocked(listSuppliers).mockReset();
  vi.mocked(listMerchants).mockReset().mockResolvedValue([]);
  vi.mocked(listStockItems).mockReset().mockResolvedValue([]);
  vi.mocked(listTransactionsForExport).mockReset().mockResolvedValue({ transactions: [], total: 0 } as never);
  vi.mocked(listSalesOrders).mockReset().mockResolvedValue([]);
  vi.mocked(listPurchaseOrders).mockReset().mockResolvedValue([]);
  vi.mocked(listQuotations).mockReset().mockResolvedValue([]);
  vi.mocked(listAllBills).mockReset().mockResolvedValue([]);
  vi.mocked(listSupplierPayments).mockReset().mockResolvedValue([]);
  vi.mocked(listCustomerReceipts).mockReset().mockResolvedValue([]);
  vi.mocked(listGlTransactionsInRange).mockReset().mockResolvedValue({ transactions: [] } as never);
  vi.mocked(listRecentOverrides).mockReset().mockResolvedValue([]);
});

describe("getDuplicateFindings — merged suppliers stop reappearing (Phase 33A)", () => {
  it("still finds a duplicate pair when both suppliers are Active", async () => {
    vi.mocked(listSuppliers).mockResolvedValue([
      supplier({ id: 1, name: "Acme Supplies", status: "Active" }),
      supplier({ id: 2, name: "acme supplies", status: "Active" }),
    ]);
    const findings = await getDuplicateFindings("co_1", "2026-08-19");
    expect(findings.filter((f) => f.entityType === "Supplier")).toHaveLength(2);
  });

  it("no longer reports a pair once one side has been merged (deactivated)", async () => {
    vi.mocked(listSuppliers).mockResolvedValue([
      supplier({ id: 1, name: "Acme Supplies", status: "Active" }),
      supplier({ id: 2, name: "acme supplies", status: "Inactive" }), // just merged away
    ]);
    const findings = await getDuplicateFindings("co_1", "2026-08-19");
    expect(findings.filter((f) => f.entityType === "Supplier")).toHaveLength(0);
  });

  it("an Inactive supplier with no Active match of the same name produces no finding at all", async () => {
    vi.mocked(listSuppliers).mockResolvedValue([supplier({ id: 2, name: "Solo Supplier", status: "Inactive" })]);
    const findings = await getDuplicateFindings("co_1", "2026-08-19");
    expect(findings.filter((f) => f.entityType === "Supplier")).toHaveLength(0);
  });
});
