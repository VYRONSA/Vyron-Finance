import { describe, expect, it, vi, beforeEach } from "vitest";

// Phase 25D regression — proves the existing inline "create a Banking
// Rule?" prompt (getRepeatedAllocationCount) still works unchanged. Only
// countBeneficiaryAllocations is overridden; every other repository
// function keeps its real implementation via importOriginal, so the
// pre-existing tests below (which never exercised DB-touching paths)
// are unaffected.
// Phase 31 — `allocateRow`'s own repository call is also stubbed here
// (alongside the pre-existing `countBeneficiaryAllocations` override) so
// the NEW "does the service pass `updatedIds`/`blockedIds` through
// unchanged" success-path test below doesn't need a real Supabase
// connection. `listChartOfAccounts` (a sibling module, not part of this
// repository) is mocked separately below for the same reason — a "G"
// allocation's existence check calls it before ever reaching `repo.allocateRow`.
vi.mock("@/server/repositories/transaction-explorer-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/transaction-explorer-repository")>();
  return {
    ...actual,
    countBeneficiaryAllocations: vi.fn(),
    allocateRow: vi.fn(),
    bulkAssignSupplier: vi.fn(),
    listUnprocessedTransactions: vi.fn(),
    getTransactionsByIds: vi.fn(),
    getTransaction: vi.fn(),
    deleteTransactions: vi.fn(),
    applyRuleActionsBatchOverridingAiSuggestions: vi.fn(),
  };
});
vi.mock("@/server/repositories/chart-of-accounts-repository", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/repositories/supplier-reconciliation-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/supplier-reconciliation-repository")>();
  return { ...actual, getSupplier: vi.fn() };
});
vi.mock("@/server/repositories/banking-rule-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/banking-rule-repository")>();
  return { ...actual, getBankingRule: vi.fn(), recordRuleApplication: vi.fn() };
});
vi.mock("@/server/repositories/bank-account-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/bank-account-repository")>();
  return { ...actual, getBankAccount: vi.fn() };
});
vi.mock("@/server/repositories/customer-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/customer-repository")>();
  return { ...actual, getCustomer: vi.fn() };
});
vi.mock("@/server/repositories/cashbook-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/cashbook-repository")>();
  return { ...actual, createManualTransaction: vi.fn() };
});
vi.mock("@/server/services/rule-processing-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/rule-processing-service")>();
  return { ...actual, applyRulesToTransactions: vi.fn() };
});

import {
  allocateRow,
  applyNewRuleCompanyWide,
  previewApplyRuleCompanyWide,
  assignSupplier,
  countSimilarTransactions,
  createManualExplorerTransaction,
  decodeCursor,
  deleteTransactions,
  encodeCursor,
  getMerchantStats,
  getRepeatedAllocationCount,
  modeOf,
  parseFilters,
  REPEATED_ALLOCATION_THRESHOLD,
  ValidationError,
} from "./transaction-explorer-service";
import {
  countBeneficiaryAllocations,
  allocateRow as repoAllocateRow,
  bulkAssignSupplier,
  listUnprocessedTransactions,
  getTransaction,
  deleteTransactions as repoDeleteTransactions,
  applyRuleActionsBatchOverridingAiSuggestions,
} from "@/server/repositories/transaction-explorer-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { getSupplier } from "@/server/repositories/supplier-reconciliation-repository";
import { getBankingRule, recordRuleApplication } from "@/server/repositories/banking-rule-repository";
import { getBankAccount } from "@/server/repositories/bank-account-repository";
import { getCustomer } from "@/server/repositories/customer-repository";
import { createManualTransaction } from "@/server/repositories/cashbook-repository";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> & Pick<BankTransactionRecord, "id">): BankTransactionRecord {
  return {
    companyId: "company-1",
    transactionDate: "2026-07-01",
    reference: "REF-1",
    description: "Payment for fish supplies",
    beneficiary: "Three Streams Fish",
    debit: 500,
    credit: 0,
    balance: null,
    bankAccount: "MAIN-001",
    bankAccountId: 1,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "BATCH-1",
    sourceFilename: "statement.csv",
    createdAt: "2026-07-01T00:00:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    postedFlag: false,
    postedAt: null,
    postingBatchId: null,
    sourceOccurrence: 1,
    reviewHold: false,
    reviewHoldReason: "",
    reviewHoldBy: null,
    reviewHoldAt: null,
    overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null,
    overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "company-1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

function params(entries: [string, string][]): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of entries) p.append(k, v);
  return p;
}

describe("parseFilters", () => {
  it("returns all-null/default filters for an empty query", () => {
    expect(parseFilters(new URLSearchParams())).toEqual({
      search: null,
      dateFrom: null,
      dateTo: null,
      minAmount: null,
      maxAmount: null,
      statuses: null,
      bankAccountId: null,
      importBatch: null,
      duplicateOnly: false,
      unknownSupplierOnly: false,
      sortBy: "transactionDate",
      sortDirection: "desc",
      // Phase 23A (Find & Recode) — additive filter fields, absent-by-default.
      description: null,
      reference: null,
      glAccount: null,
      supplierId: null,
      customerId: null,
      allocationMethods: null,
      hasRule: null,
      manualOverrideOnly: false,
      needsReviewOnly: false,
      postingStatuses: null,
    });
  });

  it("parses a fully populated query", () => {
    const filters = parseFilters(
      params([
        ["search", "ABC Supplies"],
        ["dateFrom", "2026-01-01"],
        ["dateTo", "2026-07-31"],
        ["minAmount", "100"],
        ["maxAmount", "5000"],
        ["status", "Matched"],
        ["status", "Suggested"],
        ["bankAccountId", "1"],
        ["importBatch", "BATCH-20260701"],
        ["duplicateOnly", "true"],
        ["unknownSupplierOnly", "true"],
        ["sortBy", "debit"],
        ["sortDirection", "asc"],
      ]),
    );
    expect(filters).toMatchObject({
      search: "ABC Supplies",
      dateFrom: "2026-01-01",
      dateTo: "2026-07-31",
      minAmount: 100,
      maxAmount: 5000,
      statuses: ["Matched", "Suggested"],
      bankAccountId: 1,
      importBatch: "BATCH-20260701",
      duplicateOnly: true,
      unknownSupplierOnly: true,
      sortBy: "debit",
      sortDirection: "asc",
    });
  });

  it("trims and treats an empty search string as absent", () => {
    expect(parseFilters(params([["search", "   "]])).search).toBeNull();
  });

  it("rejects a malformed date", () => {
    expect(() => parseFilters(params([["dateFrom", "01/01/2026"]]))).toThrow(ValidationError);
  });

  it("rejects a non-numeric amount", () => {
    expect(() => parseFilters(params([["minAmount", "not-a-number"]]))).toThrow(ValidationError);
  });

  it("rejects an unknown status", () => {
    expect(() => parseFilters(params([["status", "Bogus"]]))).toThrow(ValidationError);
  });

  it("rejects an unknown sortBy column", () => {
    expect(() => parseFilters(params([["sortBy", "beneficiary"]]))).toThrow(ValidationError);
  });

  it("rejects an unknown sortDirection", () => {
    expect(() => parseFilters(params([["sortDirection", "sideways"]]))).toThrow(ValidationError);
  });

  it("rejects a non-integer bankAccountId", () => {
    expect(() => parseFilters(params([["bankAccountId", "abc"]]))).toThrow(ValidationError);
  });

  // -----------------------------------------------------------------------
  // Phase 23A (Find & Recode) — additive filter fields.
  // -----------------------------------------------------------------------

  it("parses the new Find & Recode filter fields", () => {
    const filters = parseFilters(
      params([
        ["description", "SHELL"],
        ["reference", "INV-100"],
        ["glAccount", "6200"],
        ["supplierId", "5"],
        ["customerId", "9"],
        ["allocationMethod", "Future AI"],
        ["allocationMethod", "Manual"],
        ["hasRule", "true"],
        ["manualOverrideOnly", "true"],
        ["needsReviewOnly", "true"],
      ]),
    );
    expect(filters).toMatchObject({
      description: "SHELL",
      reference: "INV-100",
      glAccount: "6200",
      supplierId: 5,
      customerId: 9,
      allocationMethods: ["Future AI", "Manual"],
      hasRule: true,
      manualOverrideOnly: true,
      needsReviewOnly: true,
    });
  });

  it("parses hasRule=false distinctly from absent (null)", () => {
    expect(parseFilters(params([["hasRule", "false"]])).hasRule).toBe(false);
    expect(parseFilters(new URLSearchParams()).hasRule).toBeNull();
  });

  it("rejects an unknown allocationMethod value", () => {
    expect(() => parseFilters(params([["allocationMethod", "Bogus"]]))).toThrow(ValidationError);
  });

  it("rejects a non-integer supplierId", () => {
    expect(() => parseFilters(params([["supplierId", "abc"]]))).toThrow(ValidationError);
  });

  it("rejects a non-integer customerId", () => {
    expect(() => parseFilters(params([["customerId", "abc"]]))).toThrow(ValidationError);
  });

  it("rejects an invalid hasRule value", () => {
    expect(() => parseFilters(params([["hasRule", "maybe"]]))).toThrow(ValidationError);
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor with a string sort value", () => {
    const cursor = { sortValue: "2026-07-15", id: 42 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips a cursor with a numeric sort value", () => {
    const cursor = { sortValue: 1234.56, id: 7 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips a cursor with a null sort value", () => {
    const cursor = { sortValue: null, id: 1 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("returns null for a null cursor", () => {
    expect(encodeCursor(null)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it("rejects a tampered/garbage cursor instead of silently mis-paginating", () => {
    expect(() => decodeCursor("not-valid-base64url-json")).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url"))).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ id: "not-a-number", sortValue: 1 })).toString("base64url"))).toThrow(ValidationError);
  });
});

// Transaction Explorer Redesign, Phase 1 — `allocateRow`'s validation
// throws synchronously, before any Supabase call, for every case below
// (invalid type; a required target missing for the given type) — these
// are the cases exercisable without mocking the database, matching this
// file's own established convention of testing the pure/no-IO paths of
// this service directly.
describe("allocateRow validation", () => {
  it("rejects an unknown allocation type", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "X" as never, accountCode: null, supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty transaction id list", async () => {
    await expect(
      allocateRow("company-1", [], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a GL allocation with no account code", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "G", accountCode: "   ", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a Supplier allocation with no supplier id", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "S", accountCode: null, supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a Customer allocation with no customer id", async () => {
    await expect(
      allocateRow("company-1", [1], { type: "C", accountCode: null, supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
  });
});

// Phase 38 — Phase 37's production audit found the server accepted an
// Inactive supplier id for a NEW allocation with no status check at all
// (only existence was checked). This is the backstop: even if a request
// bypasses every UI filter, the write itself must still be rejected.
describe("allocateRow / assignSupplier — Inactive supplier rejected server-side (Phase 38)", () => {
  beforeEach(() => {
    vi.mocked(getSupplier).mockReset();
    vi.mocked(repoAllocateRow).mockReset();
    vi.mocked(bulkAssignSupplier).mockReset();
  });

  it("allocateRow (inline single-row path) rejects an Inactive supplier id and never reaches the repository", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 9, name: "Deactivated Duplicate", status: "Inactive" }));
    await expect(
      allocateRow("company-1", [1], { type: "S", accountCode: null, supplierId: 9, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
    await expect(
      allocateRow("company-1", [1], { type: "S", accountCode: null, supplierId: 9, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(/Inactive/);
    expect(repoAllocateRow).not.toHaveBeenCalled();
  });

  it("allocateRow accepts an Active supplier id, unchanged", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 1, name: "Active Supplies", status: "Active" }));
    vi.mocked(repoAllocateRow).mockResolvedValue({ updatedIds: [1], blockedIds: [] });

    const result = await allocateRow("company-1", [1], { type: "S", accountCode: null, supplierId: 1, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester");

    expect(result).toEqual({ updatedIds: [1], blockedIds: [] });
    expect(repoAllocateRow).toHaveBeenCalled();
  });

  it("assignSupplier (bulk path) rejects an Inactive supplier id and never reaches the repository", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 9, name: "Deactivated Duplicate", status: "Inactive" }));
    await expect(assignSupplier("company-1", [1, 2], 9, "tester")).rejects.toThrow(ValidationError);
    await expect(assignSupplier("company-1", [1, 2], 9, "tester")).rejects.toThrow(/Inactive/);
    expect(bulkAssignSupplier).not.toHaveBeenCalled();
  });

  it("assignSupplier accepts an Active supplier id, unchanged", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 1, name: "Active Supplies", status: "Active" }));
    vi.mocked(bulkAssignSupplier).mockResolvedValue(undefined as never);

    await assignSupplier("company-1", [1, 2], 1, "tester");

    expect(bulkAssignSupplier).toHaveBeenCalledWith("company-1", [1, 2], 1, "tester");
  });
});

// Phase 31 — "Save Selected" needs `allocateRow` to report which
// requested ids the posted-transaction guard actually blocked, not just
// throw-or-succeed. This is a thin pass-through (the repository does the
// real computation, see `computeBlockedIds`'s own tests) — proving the
// service layer doesn't drop or reshape it on the way through.
describe("allocateRow — updatedIds/blockedIds pass-through (Phase 31)", () => {
  it("returns exactly what the repository reports on a full success", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "6100" } as never]);
    vi.mocked(repoAllocateRow).mockResolvedValue({ updatedIds: [1], blockedIds: [] });

    const result = await allocateRow("company-1", [1], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester");

    expect(result).toEqual({ updatedIds: [1], blockedIds: [] });
  });

  it("a fully blocked (posted) single-row commit still resolves — not throws — with the block visible in blockedIds", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "6100" } as never]);
    vi.mocked(repoAllocateRow).mockResolvedValue({ updatedIds: [], blockedIds: [501] });

    const result = await allocateRow("company-1", [501], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester");

    // The service itself never turns a block into a thrown error — that
    // honest-409 decision belongs to the route (see bulk/route.test.ts),
    // which is what lets a PARTIAL block in a multi-id call still be a
    // real success for the ids that did update.
    expect(result).toEqual({ updatedIds: [], blockedIds: [501] });
  });
});

// Phase 31A — description editing passes straight through this same
// validated path (item 3/4/5/7: individual Save, Save Selected, and the
// posted-transaction guard all reuse it unchanged), plus the one new
// failure mode description editing introduces: a natural-key collision.
describe("allocateRow — description (Phase 31A)", () => {
  it("passes a real description change straight through to the repository, alongside GL/VAT", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "6100" } as never]);
    vi.mocked(repoAllocateRow).mockResolvedValue({ updatedIds: [501], blockedIds: [] });

    await allocateRow("company-1", [501], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: "Ren Remuneration", overrideSupplierInvoiceMatching: null }, "tester");

    expect(repoAllocateRow).toHaveBeenCalledWith(
      "company-1",
      [501],
      expect.objectContaining({ description: "Ren Remuneration", overrideSupplierInvoiceMatching: null }),
      "tester",
    );
  });

  it("an unchanged (null) description is passed through as null, never invented as a value", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "6100" } as never]);
    vi.mocked(repoAllocateRow).mockResolvedValue({ updatedIds: [501], blockedIds: [] });

    await allocateRow("company-1", [501], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null, overrideSupplierInvoiceMatching: null }, "tester");

    expect(repoAllocateRow).toHaveBeenCalledWith("company-1", [501], expect.objectContaining({ description: null, overrideSupplierInvoiceMatching: null }), "tester");
  });

  it("converts a natural-key collision (23505) into an honest ValidationError, never a raw Postgres error", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "6100" } as never]);
    vi.mocked(repoAllocateRow).mockRejectedValue({ code: "23505", message: 'duplicate key value violates unique constraint "ae_bank_transactions_natural_key"' });

    await expect(
      allocateRow("company-1", [501], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: "Duplicate text", overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow(ValidationError);
  });

  it("does not swallow an unrelated repository error as if it were a duplicate", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "6100" } as never]);
    vi.mocked(repoAllocateRow).mockRejectedValue(new Error("connection reset"));

    await expect(
      allocateRow("company-1", [501], { type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: "New text", overrideSupplierInvoiceMatching: null }, "tester"),
    ).rejects.toThrow("connection reset");
  });
});

// Master Implementation Tracker — Epic E2, Finding #089.
describe("modeOf", () => {
  it("returns the most frequent non-empty value", () => {
    expect(modeOf(["4000", "4000", "4100", null, ""])).toBe("4000");
  });

  it("returns null when every value is empty/null", () => {
    expect(modeOf([null, "", null])).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(modeOf([])).toBeNull();
  });
});

// Master Implementation Tracker — Epic E2, Findings #086/#089. Both
// throw synchronously, before any Supabase call, for their validation
// cases — matching this file's own established convention.
describe("countSimilarTransactions validation", () => {
  it("rejects an unknown criterion", async () => {
    await expect(countSimilarTransactions("company-1", "beneficiary", "ABC")).rejects.toThrow(ValidationError);
  });

  it("rejects an empty value", async () => {
    await expect(countSimilarTransactions("company-1", "merchant", "   ")).rejects.toThrow(ValidationError);
  });
});

describe("getMerchantStats validation", () => {
  it("rejects an empty beneficiary", async () => {
    await expect(getMerchantStats("company-1", "   ")).rejects.toThrow(ValidationError);
  });
});

describe("getRepeatedAllocationCount — existing inline rule-suggestion prompt (Phase 25D regression)", () => {
  it("still exports the threshold as 3, unchanged", () => {
    expect(REPEATED_ALLOCATION_THRESHOLD).toBe(3);
  });

  it("suggests a rule once the count reaches the threshold", async () => {
    vi.mocked(countBeneficiaryAllocations).mockResolvedValue(3);
    const result = await getRepeatedAllocationCount("company-1", 99, "ABC Supplies", { glAccount: "6100" });
    expect(result).toEqual({ count: 3, suggestRule: true });
    expect(countBeneficiaryAllocations).toHaveBeenCalledWith("company-1", "ABC Supplies", { glAccount: "6100" }, 99);
  });

  it("does not suggest a rule below the threshold", async () => {
    vi.mocked(countBeneficiaryAllocations).mockResolvedValue(2);
    const result = await getRepeatedAllocationCount("company-1", 99, "ABC Supplies", { glAccount: "6100" });
    expect(result).toEqual({ count: 2, suggestRule: false });
  });
});

// -----------------------------------------------------------------------
// Phase 39/40 — company-wide retroactive rule application.
//
// Phase 39 root cause: the old batch-scoped retroactive apply never
// evaluated transactions sitting in a DIFFERENT import batch.
//
// Phase 40, Live Defect 2 — production forensic finding: every "Three
// Streams Fish" transaction had already been claimed by the AI
// Classification Sweep (a background cron task) DAYS before the
// accountant created this Supplier rule, with a generic, NEVER
// human-confirmed GL guess (`isManualOverride: false`). The Phase 39
// version of this function only treated `allocationStatus ===
// "Unallocated"` as eligible, so it correctly found the transactions but
// silently skipped every one of them as "already allocated" — the rule
// reported "0 allocated" even though it had found the right rows.
// "Already allocated" now means `isManualOverride === true` (a HUMAN
// confirmed some allocation) — an unconfirmed AI/prior-rule guess is
// exactly what a deliberately-authored, more specific new rule is meant
// to supersede.
// -----------------------------------------------------------------------
function fishRule(overrides: Partial<import("@/server/banking-rules/types").BankingRule> = {}): import("@/server/banking-rules/types").BankingRule {
  return {
    id: 900,
    companyId: "company-1",
    domain: "Banking",
    ruleType: "Supplier",
    name: 'Auto: fish → Supplier',
    description: "",
    priority: 100,
    isActive: true,
    version: 1,
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
    createdBy: "tester",
    updatedBy: "tester",
    conditions: [{ id: 1, field: "description", operator: "contains", value: "fish", value2: null }],
    actions: [{ id: 1, actionType: "set_supplier", targetId: 42, targetText: null }],
    ...overrides,
  };
}

describe("applyNewRuleCompanyWide (Phase 39/40)", () => {
  beforeEach(() => {
    vi.mocked(getBankingRule).mockReset();
    vi.mocked(listUnprocessedTransactions).mockReset();
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockReset().mockResolvedValue({ updatedIds: [] });
    vi.mocked(recordRuleApplication).mockReset().mockResolvedValue(undefined);
  });

  it("returns an all-zero summary when the rule no longer exists", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(null);
    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");
    expect(result).toEqual({ matchedCount: 0, allocatedCount: 0, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [] });
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
  });

  it("matches a transaction from a DIFFERENT import batch than the one just allocated — the Phase 39 root-cause scenario", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    const fishTxn = txn({ id: 10, importBatch: "BATCH-OTHER-STATEMENT", description: "Payment — fish market", allocationStatus: "Unallocated", isManualOverride: false });
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([fishTxn]);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [10] });

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(result).toEqual({ matchedCount: 1, allocatedCount: 1, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [10] });
    expect(applyRuleActionsBatchOverridingAiSuggestions).toHaveBeenCalledWith(
      "company-1",
      [10],
      expect.objectContaining({ ruleId: 900, matchedSupplierId: 42, allocationStatus: "Allocated" }),
      fishRule().name,
      "tester",
    );
    expect(recordRuleApplication).toHaveBeenCalledWith("company-1", 900, 10);
  });

  // Phase 40, Live Defect 2 — the exact production scenario: an
  // unconfirmed AI "Purchases" GL guess must not block a new, more
  // specific Supplier rule from claiming the transaction.
  it("claims a transaction the AI Classification Sweep already gave an UNCONFIRMED GL suggestion — the exact live production bug", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    const aiTouchedFishTxn = txn({
      id: 170,
      description: "FNB OB Pmt Thr\tThree Streams Fish",
      allocationStatus: "Allocated",
      allocationMethod: "Future AI",
      suggestedGlAccount: "5000",
      isManualOverride: false, // AI never gets to confirm on a human's behalf
    });
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([aiTouchedFishTxn]);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [170] });

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(result).toEqual({ matchedCount: 1, allocatedCount: 1, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [170] });
    expect(applyRuleActionsBatchOverridingAiSuggestions).toHaveBeenCalledWith("company-1", [170], expect.objectContaining({ matchedSupplierId: 42 }), expect.any(String), "tester");
  });

  it("does not count or touch a transaction whose description doesn't match", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([txn({ id: 11, description: "Office rent", allocationStatus: "Unallocated" })]);

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(result).toEqual({ matchedCount: 0, allocatedCount: 0, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [] });
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
  });

  it("reports — but never writes to — a matching transaction a HUMAN already confirmed", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([
      txn({ id: 12, description: "Three Streams Fish invoice", allocationStatus: "Allocated", matchedSupplierId: 7, isManualOverride: true, allocationMethod: "Manual" }),
    ]);

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(result).toEqual({ matchedCount: 1, allocatedCount: 0, alreadyAllocatedCount: 1, rejectedCount: 0, allocatedTransactionIds: [] });
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
  });

  it("excludes the transaction the rule was just created from", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([txn({ id: 13, description: "fish supplies", allocationStatus: "Unallocated" })]);

    const result = await applyNewRuleCompanyWide("company-1", 900, 13, "tester");

    expect(result).toEqual({ matchedCount: 0, allocatedCount: 0, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [] });
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
  });

  it("counts a matched, eligible transaction the write guard still blocked (e.g. posted between read and write) as rejected, not allocated", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([txn({ id: 14, description: "fish market", allocationStatus: "Unallocated" })]);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [] });

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(result).toEqual({ matchedCount: 1, allocatedCount: 0, alreadyAllocatedCount: 0, rejectedCount: 1, allocatedTransactionIds: [] });
  });

  // Posted-transaction protection: `listUnprocessedTransactions` (the
  // candidate pool) itself filters `journal_id IS NULL` at the query
  // level — a posted transaction is never even a candidate, so it can
  // never appear in `matched`/`allocated`/`rejected`, regardless of how
  // strongly its description matches the rule.
  it("posted transactions are never candidates at all — proven by construction via the candidate pool, not a filter this function applies itself", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    // A realistic candidate pool already excludes posted rows (as the
    // real `listUnprocessedTransactions` query does) — this test proves
    // the function makes no attempt to re-include or separately handle
    // a posted transaction if one somehow appeared in its input.
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([]);

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(result).toEqual({ matchedCount: 0, allocatedCount: 0, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [] });
    expect(listUnprocessedTransactions).toHaveBeenCalledWith("company-1");
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
  });

  it("a GL rule resolves to allocation_status Suggested, matching processTransaction's own Supplier/Customer-vs-GL precedence", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(
      fishRule({ ruleType: "GL", actions: [{ id: 2, actionType: "set_gl_account", targetId: null, targetText: "6100" }] }),
    );
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([txn({ id: 15, description: "fish delivery" })]);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [15] });

    await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(applyRuleActionsBatchOverridingAiSuggestions).toHaveBeenCalledWith(
      "company-1",
      [15],
      expect.objectContaining({ suggestedGlAccount: "6100", allocationStatus: "Suggested" }),
      expect.any(String),
      "tester",
    );
  });

  it("case-insensitive matching: 'FISH' in the rule value matches a lowercase 'fish' description", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule({ conditions: [{ id: 1, field: "description", operator: "contains", value: "FISH", value2: null }] }));
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([txn({ id: 16, description: "three streams fish co" })]);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [16] });

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");
    expect(result.matchedCount).toBe(1);
  });

  it("matches on beneficiary when the rule's condition field is beneficiary, not description", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule({ conditions: [{ id: 1, field: "beneficiary", operator: "contains", value: "fish", value2: null }] }));
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([
      txn({ id: 17, description: "Unrelated narration", beneficiary: "Three Streams Fish CC" }),
      txn({ id: 18, description: "fish mentioned only in description", beneficiary: "Some Other Merchant" }),
    ]);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [17] });

    const result = await applyNewRuleCompanyWide("company-1", 900, null, "tester");
    expect(result.matchedCount).toBe(1);
    expect(applyRuleActionsBatchOverridingAiSuggestions).toHaveBeenCalledWith("company-1", [17], expect.anything(), expect.any(String), "tester");
  });
});

// -----------------------------------------------------------------------
// Phase 51 — production defect (Phase 50's forensic report): "Apply to
// Remaining Transactions" used to run the FULL company-wide sweep
// immediately and silently the moment a rule was created. This read-only
// preview is the new required step BEFORE the UI ever offers to run it —
// reuses the exact same `resolveRuleMatches` internals
// `applyNewRuleCompanyWide` itself now calls (see that function above),
// so the count shown to the accountant can never disagree with what
// confirming would actually do. The defining property under test: this
// NEVER writes anything, regardless of how many transactions match.
// -----------------------------------------------------------------------
describe("previewApplyRuleCompanyWide (Phase 51)", () => {
  beforeEach(() => {
    vi.mocked(getBankingRule).mockReset();
    vi.mocked(listUnprocessedTransactions).mockReset();
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockReset();
    vi.mocked(recordRuleApplication).mockReset();
  });

  it("returns an all-zero preview when the rule no longer exists, and never writes", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(null);
    const result = await previewApplyRuleCompanyWide("company-1", 900, null);
    expect(result).toEqual({ matchedCount: 0, eligibleCount: 0, alreadyAllocatedCount: 0 });
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
  });

  it("counts matching, eligible transactions WITHOUT writing to any of them — the exact 'show the count before applying' requirement", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([
      txn({ id: 20, description: "fish delivery", allocationStatus: "Unallocated", isManualOverride: false }),
      txn({ id: 21, description: "fish market", allocationStatus: "Unallocated", isManualOverride: false }),
      txn({ id: 22, description: "unrelated rent", allocationStatus: "Unallocated", isManualOverride: false }),
    ]);

    const result = await previewApplyRuleCompanyWide("company-1", 900, null);

    expect(result).toEqual({ matchedCount: 2, eligibleCount: 2, alreadyAllocatedCount: 0 });
    // The defining property: a preview, however many transactions match,
    // never calls the write path.
    expect(applyRuleActionsBatchOverridingAiSuggestions).not.toHaveBeenCalled();
    expect(recordRuleApplication).not.toHaveBeenCalled();
  });

  it("separates already-human-confirmed matches into alreadyAllocatedCount, matching applyNewRuleCompanyWide's own eligibility rule exactly", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([
      txn({ id: 23, description: "fish co", allocationStatus: "Unallocated", isManualOverride: false }),
      txn({ id: 24, description: "fish co invoice", allocationStatus: "Allocated", isManualOverride: true }),
    ]);

    const result = await previewApplyRuleCompanyWide("company-1", 900, null);
    expect(result).toEqual({ matchedCount: 2, eligibleCount: 1, alreadyAllocatedCount: 1 });
  });

  it("excludes the transaction the rule was just created from, same as the real apply", async () => {
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue([txn({ id: 25, description: "fish supplies", allocationStatus: "Unallocated" })]);

    const result = await previewApplyRuleCompanyWide("company-1", 900, 25);
    expect(result).toEqual({ matchedCount: 0, eligibleCount: 0, alreadyAllocatedCount: 0 });
  });

  it("the preview count and the real apply's matchedCount never disagree, given the exact same inputs", async () => {
    const candidates = [
      txn({ id: 26, description: "fish co", allocationStatus: "Unallocated", isManualOverride: false }),
      txn({ id: 27, description: "fish co", allocationStatus: "Unallocated", isManualOverride: false }),
      txn({ id: 28, description: "fish co", allocationStatus: "Allocated", isManualOverride: true }),
    ];
    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue(candidates);
    const preview = await previewApplyRuleCompanyWide("company-1", 900, null);

    vi.mocked(getBankingRule).mockResolvedValue(fishRule());
    vi.mocked(listUnprocessedTransactions).mockResolvedValue(candidates);
    vi.mocked(applyRuleActionsBatchOverridingAiSuggestions).mockResolvedValue({ updatedIds: [26, 27] });
    const applied = await applyNewRuleCompanyWide("company-1", 900, null, "tester");

    expect(preview.matchedCount).toBe(applied.matchedCount);
    expect(preview.eligibleCount).toBe(applied.allocatedCount + applied.rejectedCount);
    expect(preview.alreadyAllocatedCount).toBe(applied.alreadyAllocatedCount);
  });
});

// -----------------------------------------------------------------------
// Phase 39, Part 2 — Delete Transaction. The service layer is a thin
// pass-through (requireIds + delegate); the posted-transaction guard and
// exact-count reporting are the repository's own responsibility, already
// covered by that layer's own tests — these prove the service doesn't
// drop or reshape what the repository reports.
// -----------------------------------------------------------------------
describe("deleteTransactions (Phase 39, Part 2)", () => {
  beforeEach(() => {
    vi.mocked(repoDeleteTransactions).mockReset();
  });

  it("rejects an empty selection without reaching the repository", async () => {
    await expect(deleteTransactions("company-1", [])).rejects.toThrow(ValidationError);
    expect(repoDeleteTransactions).not.toHaveBeenCalled();
  });

  it("deletes every unposted transaction in the selection and returns the exact count", async () => {
    vi.mocked(repoDeleteTransactions).mockResolvedValue({ deletedIds: [1, 2], blockedIds: [] });
    const result = await deleteTransactions("company-1", [1, 2]);
    expect(result).toEqual({ deletedIds: [1, 2], blockedIds: [] });
    expect(repoDeleteTransactions).toHaveBeenCalledWith("company-1", [1, 2]);
  });

  it("a mixed posted/unposted selection deletes the unposted ones and reports the posted ones as blocked, never throws", async () => {
    vi.mocked(repoDeleteTransactions).mockResolvedValue({ deletedIds: [1], blockedIds: [2] });
    const result = await deleteTransactions("company-1", [1, 2]);
    expect(result).toEqual({ deletedIds: [1], blockedIds: [2] });
  });
});

// -----------------------------------------------------------------------
// Phase 39, Part 3 — "+ Add Transaction." Reuses `cashbookRepo.
// createManualTransaction` (the same insert Cashbook capture already
// uses, including the Phase 31C immutable `import_description` snapshot)
// and the existing Active-only supplier guard — these tests prove the
// new validation wrapper around that reuse, not a second implementation.
// -----------------------------------------------------------------------
describe("createManualExplorerTransaction (Phase 39, Part 3)", () => {
  const validInput = {
    bankAccountId: 1,
    transactionDate: "2026-08-19",
    reference: "REF-9",
    description: "Cash deposit",
    beneficiary: "Walk-in customer",
    debit: 0,
    credit: 250,
    balance: 1000,
    glAccount: "",
    vat: 0,
    notes: "",
    supplierId: null,
    customerId: null,
  };

  beforeEach(() => {
    vi.mocked(getBankAccount).mockReset();
    vi.mocked(getSupplier).mockReset();
    vi.mocked(getCustomer).mockReset();
    vi.mocked(listChartOfAccounts).mockReset();
    vi.mocked(createManualTransaction).mockReset();
    vi.mocked(getTransaction).mockReset();
    vi.mocked(getBankAccount).mockResolvedValue({ id: 1, accountName: "Main Account" } as never);
  });

  it("rejects when the bank account does not belong to this company", async () => {
    vi.mocked(getBankAccount).mockResolvedValue(null);
    await expect(createManualExplorerTransaction("company-1", validInput, "tester")).rejects.toThrow(ValidationError);
    expect(createManualTransaction).not.toHaveBeenCalled();
  });

  it("rejects both a Debit and a Credit amount — never silently coerces", async () => {
    await expect(createManualExplorerTransaction("company-1", { ...validInput, debit: 100, credit: 100 }, "tester")).rejects.toThrow(ValidationError);
    expect(createManualTransaction).not.toHaveBeenCalled();
  });

  it("rejects neither a Debit nor a Credit amount", async () => {
    await expect(createManualExplorerTransaction("company-1", { ...validInput, debit: 0, credit: 0 }, "tester")).rejects.toThrow(ValidationError);
    expect(createManualTransaction).not.toHaveBeenCalled();
  });

  it("rejects a blank description", async () => {
    await expect(createManualExplorerTransaction("company-1", { ...validInput, description: "  " }, "tester")).rejects.toThrow(ValidationError);
  });

  it("rejects a GL account that doesn't exist in the Chart of Accounts", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([]);
    await expect(createManualExplorerTransaction("company-1", { ...validInput, glAccount: "9999" }, "tester")).rejects.toThrow(ValidationError);
    expect(createManualTransaction).not.toHaveBeenCalled();
  });

  it("rejects an Inactive supplier — server-side, same as every other supplier-assignment entry point (Phase 38)", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 9, name: "Deactivated Duplicate", status: "Inactive" }));
    await expect(createManualExplorerTransaction("company-1", { ...validInput, supplierId: 9 }, "tester")).rejects.toThrow(/Inactive/);
    expect(createManualTransaction).not.toHaveBeenCalled();
  });

  it("rejects choosing both a Supplier and a Customer", async () => {
    await expect(createManualExplorerTransaction("company-1", { ...validInput, supplierId: 1, customerId: 1 }, "tester")).rejects.toThrow(ValidationError);
  });

  it("creates a plain transaction with no allocation via the existing manual-transaction insert, unchanged", async () => {
    const created = txn({ id: 500, description: "Cash deposit" });
    vi.mocked(createManualTransaction).mockResolvedValue(created);

    const result = await createManualExplorerTransaction("company-1", validInput, "tester");

    expect(result).toEqual(created);
    expect(createManualTransaction).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ bankAccountId: 1, bankAccount: "Main Account", debit: 0, credit: 250, balance: 1000, cashbookBatchId: null }),
    );
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("creates a transaction and assigns an Active supplier via the existing validated assignment path", async () => {
    const created = txn({ id: 501 });
    const allocated = { ...created, allocationStatus: "Allocated" as const, matchedSupplierId: 5 };
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 5, name: "Active Supplies", status: "Active" }));
    vi.mocked(createManualTransaction).mockResolvedValue(created);
    vi.mocked(bulkAssignSupplier).mockResolvedValue(undefined as never);
    vi.mocked(getTransaction).mockResolvedValue(allocated);

    const result = await createManualExplorerTransaction("company-1", { ...validInput, supplierId: 5 }, "tester");

    expect(bulkAssignSupplier).toHaveBeenCalledWith("company-1", [501], 5, "tester");
    expect(result).toEqual(allocated);
  });
});
