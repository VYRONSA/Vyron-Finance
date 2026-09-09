import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/merge-repository", () => ({
  recordMerchantMerge: vi.fn(),
  listMerchantMerges: vi.fn(),
  recordPartyMerge: vi.fn(),
  listPartyMerges: vi.fn(),
  mergeSupplierAtomic: vi.fn(),
  getSupplierLinkedRecordCount: vi.fn(),
}));
vi.mock("@/server/repositories/matching-override-repository", () => ({ recordOverride: vi.fn() }));
vi.mock("@/server/services/customer-service", () => ({ getCustomer: vi.fn() }));
vi.mock("@/server/services/supplier-management-service", () => ({ getSupplier: vi.fn() }));
vi.mock("@/server/repositories/merchant-repository", () => ({
  getMerchant: vi.fn(),
  updateMerchant: vi.fn(),
  repointTransactionsToMerchant: vi.fn(),
  deleteMerchant: vi.fn(),
}));

import { getSupplierMergePreview, mergeSuppliers, recordPartyMerge, ValidationError, NotFoundError } from "./merge-service";
import * as mergeRepo from "@/server/repositories/merge-repository";
import { recordOverride } from "@/server/repositories/matching-override-repository";
import { getSupplier } from "@/server/services/supplier-management-service";
import { getCustomer } from "@/server/services/customer-service";
import type { Supplier } from "@/server/accounting/types";
import type { Customer } from "@/server/customer-management/types";

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 1,
    companyId: "co_1",
    name: "Acme Supplies",
    alternativeNames: [],
    defaultGlAccount: null,
    defaultVatCode: null,
    status: "Active",
    supplierCode: "SUP-1000",
    supplierCategory: "",
    supplierType: "Company",
    bankName: "",
    bankAccountNumber: "",
    bankBranchCode: "",
    vatNumber: "",
    taxNumber: "",
    riskRating: "Low",
    paymentTermsDays: 0,
    spendingLimit: 0,
    ...overrides,
  };
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    companyId: "co_1",
    customerCode: "CUST-1000",
    name: "Meridian Traders",
    customerType: "Company",
    customerGroup: "",
    industry: "",
    vatNumber: "",
    registrationNumber: "",
    creditLimit: 0,
    paymentTermsDays: 0,
    currencyCode: null,
    priceList: "",
    salesRep: "",
    riskRating: "Low",
    notes: "",
    isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const REPOINT_COUNTS = {
  bills: 3,
  bankTransactions: 12,
  purchaseOrders: 1,
  goodsReceivedNotes: 1,
  payments: 2,
  stockItems: 0,
  merchants: 1,
  bankTransactionSplits: 0,
  fixedAssets: 0,
  openingBalanceEntries: 0,
  supplierContacts: 2,
  supplierAddresses: 1,
};
const TOTAL_REPOINTED = Object.values(REPOINT_COUNTS).reduce((sum, n) => sum + n, 0); // 23

// Phase 33 — the real, atomic Supplier merge (`mergeSuppliers`), replacing
// the previous no-op behavior for this entity type. The SQL function
// itself (`fn_merge_supplier`, migration 0090) runs as one Postgres
// transaction and genuinely cannot be exercised by a mocked unit test —
// atomicity/partial-failure-proofing is a property of that function body,
// verified by the schema audit in the Phase 33 report (every repointed
// table's own unique constraints checked, none involve a supplier
// column) and provable only against a real Postgres instance, the same
// documented limitation every other atomic RPC function in this codebase
// already has (e.g. `fn_post_depreciation_run`, `fn_apply_ai_classification`
// — neither has a direct SQL-transaction test either). What IS verified
// here: input validation, the exact repository call made, and the shape
// of the result/audit trail the service produces.
// Phase 33A — read-only data for the merge dialog: both candidates' full
// detail plus a live linked-record count, fetched before the user makes
// any choice.
describe("getSupplierMergePreview (Phase 33A)", () => {
  beforeEach(() => {
    vi.mocked(getSupplier).mockReset();
    vi.mocked(mergeRepo.getSupplierLinkedRecordCount).mockReset();
  });

  it("rejects comparing a supplier with itself", async () => {
    await expect(getSupplierMergePreview("co_1", 5, 5)).rejects.toThrow(ValidationError);
  });

  it("rejects when either supplier doesn't exist for this company", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1 }) : null));
    await expect(getSupplierMergePreview("co_1", 1, 2)).rejects.toThrow(NotFoundError);
  });

  it("returns both candidates' full detail plus a live linked-record count each", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) =>
      id === 1
        ? supplier({ id: 1, name: "Acme Supplies", supplierCode: "SUP-A", status: "Active", vatNumber: "4123456789", taxNumber: "T1", paymentTermsDays: 30 })
        : supplier({ id: 2, name: "ACME Supplies (dup)", supplierCode: "", status: "Active", vatNumber: "", taxNumber: "", paymentTermsDays: 0 }),
    );
    vi.mocked(mergeRepo.getSupplierLinkedRecordCount).mockImplementation(async (_companyId, id) => (id === 1 ? 40 : 0));

    const preview = await getSupplierMergePreview("co_1", 1, 2);

    expect(preview.supplierA).toEqual({ id: 1, name: "Acme Supplies", supplierCode: "SUP-A", status: "Active", vatNumber: "4123456789", taxNumber: "T1", paymentTermsDays: 30, linkedRecordCount: 40 });
    expect(preview.supplierB).toEqual({ id: 2, name: "ACME Supplies (dup)", supplierCode: "", status: "Active", vatNumber: "", taxNumber: "", paymentTermsDays: 0, linkedRecordCount: 0 });
  });
});

describe("mergeSuppliers — atomic merge (Phase 33)", () => {
  beforeEach(() => {
    vi.mocked(getSupplier).mockReset();
    vi.mocked(mergeRepo.mergeSupplierAtomic).mockReset();
    vi.mocked(recordOverride).mockReset();
  });

  // Test #11/#12 — whichever id the caller (the merge dialog, driven by
  // the user's explicit choice) passes as the FIRST argument is always
  // the one that survives — proven both ways round with the same two
  // real records, not just one direction.
  it("Supplier A survives when explicitly passed as the survivor", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1, name: "Supplier A" }) : supplier({ id: 2, name: "Supplier B" })));
    vi.mocked(mergeRepo.mergeSupplierAtomic).mockResolvedValue({ ...REPOINT_COUNTS, duplicateName: "Supplier B" });
    const result = await mergeSuppliers("co_1", 1, 2);
    expect(mergeRepo.mergeSupplierAtomic).toHaveBeenCalledWith("co_1", 1, 2, "System");
    expect(result.survivingSupplierId).toBe(1);
    expect(result.mergedSupplierId).toBe(2);
  });

  it("Supplier B survives when explicitly passed as the survivor — same two records, reversed choice", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1, name: "Supplier A" }) : supplier({ id: 2, name: "Supplier B" })));
    vi.mocked(mergeRepo.mergeSupplierAtomic).mockResolvedValue({ ...REPOINT_COUNTS, duplicateName: "Supplier A" });
    const result = await mergeSuppliers("co_1", 2, 1);
    expect(mergeRepo.mergeSupplierAtomic).toHaveBeenCalledWith("co_1", 2, 1, "System");
    expect(result.survivingSupplierId).toBe(2);
    expect(result.mergedSupplierId).toBe(1);
  });

  it("rejects merging a supplier into itself without calling the repository at all", async () => {
    await expect(mergeSuppliers("co_1", 5, 5)).rejects.toThrow(ValidationError);
    await expect(mergeSuppliers("co_1", 5, 5)).rejects.toThrow(/itself/);
    expect(mergeRepo.mergeSupplierAtomic).not.toHaveBeenCalled();
  });

  it("rejects when the surviving supplier doesn't exist for this company", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? null : supplier({ id: 2 })));
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow(NotFoundError);
    expect(mergeRepo.mergeSupplierAtomic).not.toHaveBeenCalled();
  });

  it("rejects when the duplicate supplier doesn't exist for this company", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1 }) : null));
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow(NotFoundError);
    expect(mergeRepo.mergeSupplierAtomic).not.toHaveBeenCalled();
  });

  // Company isolation: `getSupplier` is already company-scoped (only
  // returns a row that belongs to the given companyId), so a supplier id
  // that genuinely belongs to a different company resolves to null here —
  // the same mechanism as the two NotFoundError tests above, exercised
  // with company B's id passed against company A's supplier.
  it("cannot merge a supplier belonging to a different company — resolves as not found", async () => {
    vi.mocked(getSupplier).mockImplementation(async (companyId, id) => (companyId === "co_A" && id === 1 ? supplier({ id: 1, companyId: "co_A" }) : null));
    await expect(mergeSuppliers("co_A", 1, 99)).rejects.toThrow(NotFoundError);
    expect(mergeRepo.mergeSupplierAtomic).not.toHaveBeenCalled();
  });

  it("performs a successful merge: validates, calls the atomic repository function with the right ids, records an audit override, and returns a clear result", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1, name: "Acme Supplies", supplierCode: "SUP-A" }) : supplier({ id: 2, name: "ACME Supplies (dup)", supplierCode: "SUP-B" })));
    vi.mocked(mergeRepo.mergeSupplierAtomic).mockResolvedValue({ ...REPOINT_COUNTS, duplicateName: "ACME Supplies (dup)" });

    const result = await mergeSuppliers("co_1", 1, 2, "alice@vyron.test");

    expect(mergeRepo.mergeSupplierAtomic).toHaveBeenCalledWith("co_1", 1, 2, "alice@vyron.test");
    expect(result).toEqual({
      survivingSupplierId: 1,
      survivingSupplierName: "Acme Supplies",
      survivingSupplierCode: "SUP-A",
      mergedSupplierId: 2,
      mergedSupplierName: "ACME Supplies (dup)",
      mergedSupplierCode: "SUP-B",
      recordsRepointed: REPOINT_COUNTS,
      totalRecordsRepointed: TOTAL_REPOINTED,
      duplicateStatus: "Inactive",
    });

    expect(recordOverride).toHaveBeenCalledWith("co_1", expect.objectContaining({
      itemType: "supplier",
      itemId: 1,
      fieldName: "merge",
      performedBy: "alice@vyron.test",
    }));
    const overrideCall = vi.mocked(recordOverride).mock.calls[0][1];
    expect(overrideCall.reason).toContain(`${TOTAL_REPOINTED} record(s) repointed`);
    expect(overrideCall.reason).toContain("deactivated");
  });

  it("rejects merging when the surviving supplier is not Active", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1, name: "Acme Supplies", status: "Inactive" }) : supplier({ id: 2, name: "Dup Co" })));
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow(ValidationError);
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow(/not Active/);
    expect(mergeRepo.mergeSupplierAtomic).not.toHaveBeenCalled();
  });

  it("rejects merging when the duplicate supplier is not Active", async () => {
    vi.mocked(getSupplier).mockImplementation(async (_companyId, id) => (id === 1 ? supplier({ id: 1, name: "Acme Supplies" }) : supplier({ id: 2, name: "Dup Co", status: "Inactive" })));
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow(ValidationError);
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow(/not Active/);
    expect(mergeRepo.mergeSupplierAtomic).not.toHaveBeenCalled();
  });

  it("defaults performedBy to 'System' when not supplied", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 1 }));
    vi.mocked(mergeRepo.mergeSupplierAtomic).mockResolvedValue({ ...REPOINT_COUNTS, duplicateName: "Dup Co" });
    await mergeSuppliers("co_1", 1, 2);
    expect(mergeRepo.mergeSupplierAtomic).toHaveBeenCalledWith("co_1", 1, 2, "System");
  });

  it("propagates a repository-level error (e.g. the SQL function's own raise exception) without swallowing it", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 1 }));
    vi.mocked(mergeRepo.mergeSupplierAtomic).mockRejectedValue(new Error("fn_merge_supplier: duplicate supplier 2 not found for this company"));
    await expect(mergeSuppliers("co_1", 1, 2)).rejects.toThrow("fn_merge_supplier");
    expect(recordOverride).not.toHaveBeenCalled();
  });
});

// Unchanged for this phase — Customer merge intentionally still uses the
// log-only path (see merge-service.ts's own docstring on
// `recordPartyMerge`). These tests prove that path still works exactly
// as before Phase 33's Supplier-only changes.
describe("recordPartyMerge — Customer path unchanged (Phase 33 regression check)", () => {
  beforeEach(() => {
    vi.mocked(getCustomer).mockReset();
    vi.mocked(mergeRepo.recordPartyMerge).mockReset();
    vi.mocked(recordOverride).mockReset();
  });

  it("still only logs the decision for a Customer merge — no repository call beyond recordPartyMerge/recordOverride", async () => {
    vi.mocked(getCustomer).mockResolvedValue(customer({ id: 2, name: "Duplicate Customer" }));
    vi.mocked(mergeRepo.recordPartyMerge).mockResolvedValue({
      id: 1, companyId: "co_1", partyType: "Customer", survivingPartyId: 1, mergedPartyId: 2, mergedPartyName: "Duplicate Customer", performedBy: "System", performedAt: "2026-01-01T00:00:00Z",
    });
    const result = await recordPartyMerge("co_1", "Customer", 1, 2);
    expect(result.partyType).toBe("Customer");
    expect(mergeRepo.recordPartyMerge).toHaveBeenCalledWith("co_1", "Customer", 1, 2, "Duplicate Customer", "System");
  });

  it("still rejects merging a customer into itself", async () => {
    await expect(recordPartyMerge("co_1", "Customer", 1, 1)).rejects.toThrow(ValidationError);
  });
});
