/**
 * Phase 25F — Find & Recode saved filter presets service. Covers
 * server-side validation of the saved filter structure (write path) and
 * defensive reconstruction of a possibly malformed stored value (read
 * path), plus the thin CRUD wrappers' tenant/user scoping pass-through
 * and duplicate-name handling.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/find-and-recode-preset-repository", () => ({
  listFindAndRecodePresets: vi.fn(),
  createFindAndRecodePreset: vi.fn(),
  renameFindAndRecodePreset: vi.fn(),
  deleteFindAndRecodePreset: vi.fn(),
}));

import {
  sanitizeTransactionExplorerFilters,
  listPresets,
  savePreset,
  renamePreset,
  deletePreset,
  ValidationError,
} from "./find-and-recode-preset-service";
import * as repo from "@/server/repositories/find-and-recode-preset-repository";
import type { TransactionExplorerFilters } from "@/server/accounting/types";
import type { FindAndRecodeFilterPreset } from "@/server/repositories/find-and-recode-preset-repository";

const FULL_FILTERS: TransactionExplorerFilters = {
  search: null, dateFrom: "2026-01-01", dateTo: "2026-01-31", minAmount: 100, maxAmount: 5000,
  statuses: ["Matched", "Unallocated"], bankAccountId: 3, importBatch: null, duplicateOnly: false,
  unknownSupplierOnly: false, sortBy: "debit", sortDirection: "asc", description: "SHELL", reference: "REF1",
  glAccount: "6100", supplierId: 42, customerId: 7, allocationMethods: ["Future AI"], hasRule: true,
  manualOverrideOnly: true, needsReviewOnly: true,
};

const EMPTY_FILTERS: TransactionExplorerFilters = {
  search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null, statuses: null,
  bankAccountId: null, importBatch: null, duplicateOnly: false, unknownSupplierOnly: false,
  sortBy: "transactionDate", sortDirection: "desc", description: null, reference: null, glAccount: null,
  supplierId: null, customerId: null, allocationMethods: null, hasRule: null, manualOverrideOnly: false, needsReviewOnly: false,
};

function preset(overrides: Partial<FindAndRecodeFilterPreset> = {}): FindAndRecodeFilterPreset {
  return {
    id: 1, companyId: "company-a", userId: "user-1", name: "My Filter", filters: EMPTY_FILTERS,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(repo.listFindAndRecodePresets).mockReset().mockResolvedValue([]);
  vi.mocked(repo.createFindAndRecodePreset).mockReset().mockResolvedValue(preset());
  vi.mocked(repo.renameFindAndRecodePreset).mockReset().mockResolvedValue(preset());
  vi.mocked(repo.deleteFindAndRecodePreset).mockReset().mockResolvedValue(undefined);
});

describe("sanitizeTransactionExplorerFilters — save with every supported filter (edge case 2)", () => {
  it("preserves every field exactly for a fully populated, well-formed filter object", () => {
    expect(sanitizeTransactionExplorerFilters(FULL_FILTERS)).toEqual(FULL_FILTERS);
  });
});

describe("sanitizeTransactionExplorerFilters — save with no filters (edge case 1)", () => {
  it("preserves empty/null values correctly, never silently adding a default constraint", () => {
    expect(sanitizeTransactionExplorerFilters(EMPTY_FILTERS)).toEqual(EMPTY_FILTERS);
  });

  it("reconstructs the same empty shape from a bare empty object", () => {
    expect(sanitizeTransactionExplorerFilters({})).toEqual(EMPTY_FILTERS);
  });
});

describe("sanitizeTransactionExplorerFilters — malformed/corrupted input (edge case 8)", () => {
  it("never crashes on null, undefined, a primitive, or an array", () => {
    expect(sanitizeTransactionExplorerFilters(null)).toEqual(EMPTY_FILTERS);
    expect(sanitizeTransactionExplorerFilters(undefined)).toEqual(EMPTY_FILTERS);
    expect(sanitizeTransactionExplorerFilters("not an object")).toEqual(EMPTY_FILTERS);
    expect(sanitizeTransactionExplorerFilters([1, 2, 3])).toEqual(EMPTY_FILTERS);
  });

  it("degrades each field independently to its safe default rather than failing the whole object", () => {
    const result = sanitizeTransactionExplorerFilters({
      dateFrom: 12345, // wrong type
      minAmount: "not a number", // wrong type
      statuses: ["Matched", "NotARealStatus", 42], // partially invalid array
      sortBy: "totally-invalid-column",
      sortDirection: "sideways",
      hasRule: "yes", // wrong type — must be boolean or null
      description: "SHELL", // this one is valid and must survive
    });
    expect(result.dateFrom).toBeNull();
    expect(result.minAmount).toBeNull();
    expect(result.statuses).toEqual(["Matched"]);
    expect(result.sortBy).toBe("transactionDate");
    expect(result.sortDirection).toBe("desc");
    expect(result.hasRule).toBeNull();
    expect(result.description).toBe("SHELL");
  });

  it("drops an allocationMethods array down to only its genuinely valid entries, or null if none are valid", () => {
    expect(sanitizeTransactionExplorerFilters({ allocationMethods: ["Future AI", "Not A Real Method"] }).allocationMethods).toEqual(["Future AI"]);
    expect(sanitizeTransactionExplorerFilters({ allocationMethods: ["Not Real"] }).allocationMethods).toBeNull();
  });
});

describe("listPresets — sanitizes every stored row on read (deleted-referenced-entity safety)", () => {
  it("never crashes even if a stored row's filters were corrupted by a direct DB write", async () => {
    vi.mocked(repo.listFindAndRecodePresets).mockResolvedValue([preset({ filters: { corrupted: true } as never })]);
    const result = await listPresets("company-a", "user-1");
    expect(result[0].filters).toEqual(EMPTY_FILTERS);
  });

  it("passes the exact company and user through to the repository (tenant + ownership isolation)", async () => {
    await listPresets("company-a", "user-1");
    expect(repo.listFindAndRecodePresets).toHaveBeenCalledWith("company-a", "user-1");
  });

  it("a deleted supplier/customer/bank account referenced by a preset's filters is preserved as-is (a plain id, not re-validated against current data) — applying it simply returns whatever the current search finds, per the brief's own 'appropriate current result' instruction", async () => {
    vi.mocked(repo.listFindAndRecodePresets).mockResolvedValue([preset({ filters: { ...EMPTY_FILTERS, supplierId: 999999 } })]);
    const result = await listPresets("company-a", "user-1");
    expect(result[0].filters.supplierId).toBe(999999);
  });
});

describe("savePreset — validation and tenant/user scoping", () => {
  it("rejects an empty name without ever calling the repository", async () => {
    await expect(savePreset("company-a", "user-1", "   ", EMPTY_FILTERS)).rejects.toThrow(ValidationError);
    expect(repo.createFindAndRecodePreset).not.toHaveBeenCalled();
  });

  it("rejects a name over 100 characters", async () => {
    await expect(savePreset("company-a", "user-1", "x".repeat(101), EMPTY_FILTERS)).rejects.toThrow(ValidationError);
  });

  it("trims the name and sanitizes the filters before persisting", async () => {
    await savePreset("company-a", "user-1", "  My Filter  ", FULL_FILTERS);
    expect(repo.createFindAndRecodePreset).toHaveBeenCalledWith("company-a", "user-1", "My Filter", FULL_FILTERS);
  });

  it("converts a unique-constraint violation into a clean ValidationError (duplicate names, edge case 7)", async () => {
    vi.mocked(repo.createFindAndRecodePreset).mockRejectedValue({ code: "23505", message: 'duplicate key value violates unique constraint "find_and_recode_filter_presets_user_id_company_id_name_key"' });
    await expect(savePreset("company-a", "user-1", "My Filter", EMPTY_FILTERS)).rejects.toThrow(ValidationError);
  });

  it("rethrows a genuinely unrelated database error unchanged", async () => {
    const dbError = new Error("connection lost");
    vi.mocked(repo.createFindAndRecodePreset).mockRejectedValue(dbError);
    await expect(savePreset("company-a", "user-1", "My Filter", EMPTY_FILTERS)).rejects.toThrow("connection lost");
  });
});

describe("renamePreset — validation, ownership, and duplicate names", () => {
  it("rejects an empty new name", async () => {
    await expect(renamePreset("company-a", "user-1", 1, "")).rejects.toThrow(ValidationError);
  });

  it("throws when the repository reports no matching row (tampered id / another user's / another company's preset)", async () => {
    vi.mocked(repo.renameFindAndRecodePreset).mockResolvedValue(null);
    await expect(renamePreset("company-a", "user-1", 999, "New Name")).rejects.toThrow(ValidationError);
  });

  it("converts a unique-constraint violation into a clean ValidationError", async () => {
    vi.mocked(repo.renameFindAndRecodePreset).mockRejectedValue({ code: "23505", message: "find_and_recode_filter_presets duplicate" });
    await expect(renamePreset("company-a", "user-1", 1, "Taken")).rejects.toThrow(ValidationError);
  });

  it("passes the exact company, user, and preset id through to the repository", async () => {
    await renamePreset("company-a", "user-1", 1, "New Name");
    expect(repo.renameFindAndRecodePreset).toHaveBeenCalledWith("company-a", "user-1", 1, "New Name");
  });
});

describe("deletePreset — tenant/user scoping", () => {
  it("passes the exact company, user, and preset id through to the repository", async () => {
    await deletePreset("company-a", "user-1", 1);
    expect(repo.deleteFindAndRecodePreset).toHaveBeenCalledWith("company-a", "user-1", 1);
  });
});
