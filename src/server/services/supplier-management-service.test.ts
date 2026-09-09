import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/supplier-management-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/supplier-management-repository")>();
  return {
    ...actual,
    listSupplierContacts: vi.fn(),
    createSupplierContact: vi.fn(),
    deleteSupplierContact: vi.fn(),
    listSupplierAddresses: vi.fn(),
    createSupplierAddress: vi.fn(),
    deleteSupplierAddress: vi.fn(),
    updateSupplier: vi.fn(),
  };
});
vi.mock("@/server/repositories/supplier-reconciliation-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/supplier-reconciliation-repository")>();
  return { ...actual, getSupplier: vi.fn(), createSupplierByName: vi.fn(), findSupplierByCode: vi.fn(), findSupplierByName: vi.fn() };
});
vi.mock("@/server/services/communication-service", () => ({ queueCommunication: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));
vi.mock("@/server/repositories/permission-repository", () => ({ recordPermissionAuditEntry: vi.fn() }));

import { bulkImportSuppliers, createSupplier, editRequiresElevatedPermission, ValidationError } from "./supplier-management-service";
import {
  listSupplierContacts,
  createSupplierContact,
  deleteSupplierContact,
  listSupplierAddresses,
  createSupplierAddress,
  deleteSupplierAddress,
  NotFoundError,
} from "./supplier-management-service";
import * as repo from "@/server/repositories/supplier-management-repository";
import { createSupplierByName, findSupplierByCode, findSupplierByName, getSupplier } from "@/server/repositories/supplier-reconciliation-repository";
import type { Supplier } from "@/server/accounting/types";

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

describe("editRequiresElevatedPermission", () => {
  it("requires elevated permission when bank name is present", () => {
    expect(editRequiresElevatedPermission({ bankName: "First National Bank" })).toBe(true);
  });

  it("requires elevated permission when bank account number is present", () => {
    expect(editRequiresElevatedPermission({ bankAccountNumber: "62050837304" })).toBe(true);
  });

  it("requires elevated permission when bank branch code is present", () => {
    expect(editRequiresElevatedPermission({ bankBranchCode: "250655" })).toBe(true);
  });

  it("does not require elevated permission for non-banking fields", () => {
    expect(editRequiresElevatedPermission({ name: "New Supplier Name", supplierCategory: "Raw Materials", vatNumber: "4123456789" })).toBe(false);
  });

  it("does not require elevated permission for an empty edit", () => {
    expect(editRequiresElevatedPermission({})).toBe(false);
  });
});

describe("ValidationError", () => {
  it("is a real Error subclass", () => {
    expect(new ValidationError("test") instanceof Error).toBe(true);
  });
});

// Phase 33 — `createSupplierByName` is a bare, unconditional insert with
// no rollback if a later validation-equivalent check throws (there was
// no such check before the row was created). These regression tests
// prove the CURRENT (fixed) behavior: a row that should be rejected is
// rejected BEFORE `createSupplierByName` is ever called, so no orphan
// supplier is left behind. Before the fix, `createSupplierByName` would
// have already been called in both cases below.
describe("createSupplier — orphan-creation prevention (Phase 33)", () => {
  beforeEach(() => {
    vi.mocked(createSupplierByName).mockReset();
    vi.mocked(findSupplierByCode).mockReset();
  });

  it("rejects a duplicate Supplier Code without ever creating the row", async () => {
    vi.mocked(findSupplierByCode).mockResolvedValue(supplier({ id: 9, name: "Existing Co", supplierCode: "SUP-1" }));
    await expect(createSupplier("co_1", { name: "New Co", supplierCode: "SUP-1" })).rejects.toThrow(ValidationError);
    await expect(createSupplier("co_1", { name: "New Co", supplierCode: "SUP-1" })).rejects.toThrow(/already used by Existing Co/);
    expect(createSupplierByName).not.toHaveBeenCalled();
  });

  it("rejects negative Payment Terms without ever creating the row", async () => {
    await expect(createSupplier("co_1", { name: "New Co", paymentTermsDays: -5 })).rejects.toThrow(ValidationError);
    expect(createSupplierByName).not.toHaveBeenCalled();
  });

  it("creates normally when the code is unique and fields are valid", async () => {
    vi.mocked(findSupplierByCode).mockResolvedValue(null);
    vi.mocked(createSupplierByName).mockResolvedValue(supplier({ id: 10, name: "New Co" }));
    const result = await createSupplier("co_1", { name: "New Co" }, { skipCommunication: true });
    expect(result.name).toBe("New Co");
    expect(createSupplierByName).toHaveBeenCalledWith("co_1", "New Co");
  });
});

// Phase 33 — production incident: no duplicate-prevention existed on
// Supplier CSV import at all (no unique constraint on `name`, blank
// Supplier Code never touches the DB's own partial unique index), so
// re-importing the same file after an unclear success message silently
// created a second, fully independent supplier per row. Fixed by reusing
// `findSupplierByName` — the SAME case-insensitive lookup the Bills
// importer already established as this codebase's supplier-identity
// rule — rather than inventing a new one (e.g. name alone as a unique
// key would be unsafe; this only SKIPS a create on a match, it never
// enforces uniqueness at the DB level).
describe("bulkImportSuppliers — idempotency (Phase 33)", () => {
  beforeEach(() => {
    vi.mocked(findSupplierByName).mockReset();
    vi.mocked(findSupplierByCode).mockReset().mockResolvedValue(null);
    vi.mocked(createSupplierByName).mockReset();
    // The parser defaults a blank Payment Terms (Days) cell to 30, which
    // routes a successful `createSupplier` call through its follow-up
    // `updateSupplier` branch — mocked here so "creates a row" tests
    // don't depend on that unrelated branch's own repository calls.
    vi.mocked(getSupplier).mockReset().mockResolvedValue(supplier({ id: 20, name: "Brand New Co" }));
    vi.mocked(repo.updateSupplier).mockReset().mockResolvedValue(supplier({ id: 20, name: "Brand New Co", paymentTermsDays: 30 }));
  });

  it("skips a row whose name matches an existing supplier — counted as a duplicate, not created or failed", async () => {
    vi.mocked(findSupplierByName).mockResolvedValue(supplier({ id: 5, name: "Acme Supplies" }));
    const outcome = await bulkImportSuppliers("co_1", "Name\nAcme Supplies");
    expect(outcome).toMatchObject({ created: 0, duplicates: 1, failed: 0, errors: [] });
    expect(createSupplierByName).not.toHaveBeenCalled();
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain("already exists as supplier");
  });

  it("creates a row whose name has no existing match", async () => {
    vi.mocked(findSupplierByName).mockResolvedValue(null);
    vi.mocked(createSupplierByName).mockResolvedValue(supplier({ id: 20, name: "Brand New Co" }));
    const outcome = await bulkImportSuppliers("co_1", "Name\nBrand New Co");
    expect(outcome).toMatchObject({ created: 1, duplicates: 0, failed: 0 });
  });

  it("re-importing the identical file a second time reports duplicates, not new creations", async () => {
    // Simulates the file already having been imported once — every name now resolves to an existing supplier.
    vi.mocked(findSupplierByName).mockResolvedValue(supplier({ id: 7, name: "Repeat Co" }));
    const outcome = await bulkImportSuppliers("co_1", "Name\nRepeat Co");
    expect(outcome.created).toBe(0);
    expect(outcome.duplicates).toBe(1);
    expect(createSupplierByName).not.toHaveBeenCalled();
  });

  it("leaves the existing supplier record completely untouched on a duplicate match — no create or update call of any kind", async () => {
    const existing = supplier({ id: 5, name: "Acme Supplies", supplierCategory: "Original Category" });
    vi.mocked(findSupplierByName).mockResolvedValue(existing);
    const outcome = await bulkImportSuppliers("co_1", "Name,Category\nAcme Supplies,Different Category");
    expect(outcome.duplicates).toBe(1);
    expect(createSupplierByName).not.toHaveBeenCalled();
  });
});

describe("Supplier Contacts/Addresses — cross-company ownership guard (Phase 25K)", () => {
  beforeEach(() => {
    vi.mocked(getSupplier).mockReset();
    vi.mocked(repo.listSupplierContacts).mockReset().mockResolvedValue([]);
    vi.mocked(repo.createSupplierContact).mockReset();
    vi.mocked(repo.deleteSupplierContact).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(repo.listSupplierAddresses).mockReset().mockResolvedValue([]);
    vi.mocked(repo.createSupplierAddress).mockReset();
    vi.mocked(repo.deleteSupplierAddress).mockReset().mockResolvedValue(undefined as never);
  });

  it("rejects listing contacts for a supplier that doesn't belong to this company", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(listSupplierContacts("company-a", 999)).rejects.toThrow(NotFoundError);
    expect(repo.listSupplierContacts).not.toHaveBeenCalled();
  });

  it("rejects creating a contact for a supplier that doesn't belong to this company", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(createSupplierContact("company-a", 999, { name: "Jane" })).rejects.toThrow(NotFoundError);
    expect(repo.createSupplierContact).not.toHaveBeenCalled();
  });

  it("rejects deleting a contact for a supplier that doesn't belong to this company", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(deleteSupplierContact("company-a", 999, 5)).rejects.toThrow(NotFoundError);
    expect(repo.deleteSupplierContact).not.toHaveBeenCalled();
  });

  it("rejects listing/creating/deleting addresses for a supplier that doesn't belong to this company", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(listSupplierAddresses("company-a", 999)).rejects.toThrow(NotFoundError);
    await expect(createSupplierAddress("company-a", 999, { addressType: "Billing", line1: "1 Main St" })).rejects.toThrow(NotFoundError);
    await expect(deleteSupplierAddress("company-a", 999, 5)).rejects.toThrow(NotFoundError);
    expect(repo.listSupplierAddresses).not.toHaveBeenCalled();
    expect(repo.createSupplierAddress).not.toHaveBeenCalled();
    expect(repo.deleteSupplierAddress).not.toHaveBeenCalled();
  });

  it("proceeds normally when the supplier genuinely belongs to this company", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 5, companyId: "co_1" }));

    await listSupplierContacts("co_1", 5);
    expect(repo.listSupplierContacts).toHaveBeenCalledWith(5);

    await deleteSupplierContact("co_1", 5, 10);
    expect(repo.deleteSupplierContact).toHaveBeenCalledWith(10);
  });
});
