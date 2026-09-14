/**
 * Phase 23A — Find & Recode. Every dependency is mocked; nothing here
 * touches a real Supabase project. Covers: GL account validation,
 * selection resolution (explicit ids vs. "all matching"), the safety-
 * critical batch cap, posted-transaction protection, preview computation,
 * and the commit write path (reusing `bulkRecodeGlAccount`).
 *
 * Phase 25G extends this same file with Supplier and Customer recode —
 * same selection/batch-cap/posted-protection machinery, reused via the
 * service's own `resolveSelectionAndSplit`, only the target-validation
 * and write call differ.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/transaction-explorer-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/transaction-explorer-repository")>();
  return { ...actual, getTransactionsByIds: vi.fn(), bulkRecodeGlAccount: vi.fn(), bulkRecodeSupplier: vi.fn(), bulkRecodeCustomer: vi.fn(), bulkRecodeVat: vi.fn() };
});
vi.mock("@/server/repositories/chart-of-accounts-repository", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/repositories/vat-treatment-repository", () => ({ listVatTreatments: vi.fn() }));
vi.mock("@/server/repositories/supplier-reconciliation-repository", () => ({ getSupplier: vi.fn() }));
vi.mock("@/server/repositories/customer-repository", () => ({ getCustomer: vi.fn(), listCustomers: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", async () => {
  const actual = await vi.importActual<typeof import("./transaction-explorer-service")>("./transaction-explorer-service");
  return { ...actual, listTransactionsForExport: vi.fn() };
});

import {
  previewRecode,
  commitRecode,
  previewSupplierRecode,
  commitSupplierRecode,
  previewCustomerRecode,
  commitCustomerRecode,
  previewVatRecode,
  commitVatRecode,
  MAX_RECODE_BATCH_SIZE,
  ValidationError,
  type RecodeSelection,
} from "./find-and-recode-service";
import { getTransactionsByIds, bulkRecodeGlAccount, bulkRecodeSupplier, bulkRecodeCustomer, bulkRecodeVat } from "@/server/repositories/transaction-explorer-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listVatTreatments } from "@/server/repositories/vat-treatment-repository";
import { getSupplier } from "@/server/repositories/supplier-reconciliation-repository";
import { getCustomer, listCustomers } from "@/server/repositories/customer-repository";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { Customer } from "@/server/customer-management/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

function account(overrides: Partial<ChartOfAccount> = {}): ChartOfAccount {
  return {
    id: 1, companyId: "company-a", accountCode: "6200", description: "Motor Vehicle Expenses", accountType: "Expense", category: "",
    normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null,
    departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 1, companyId: "company-a", name: "Acme Supplies", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null,
    status: "Active", supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 30, spendingLimit: 0,
    ...overrides,
  };
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1, companyId: "company-a", customerCode: "CUST-001", name: "Northwood Ltd", customerType: "Company", customerGroup: "",
    industry: "", vatNumber: "", registrationNumber: "", creditLimit: 0, paymentTermsDays: 30, currencyCode: "ZAR", priceList: "",
    salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function vatTreatment(overrides: Partial<VatTreatment> = {}): VatTreatment {
  return {
    id: 1, companyId: "company-a", code: "STD", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function transaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "company-a", transactionDate: "2026-08-01", reference: "REF-1", description: "Shell Garage", beneficiary: "Shell",
    debit: 500, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Allocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: "6100", suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "", isManualOverride: true,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

function idsSelection(transactionIds: number[]): RecodeSelection {
  return { mode: "ids", transactionIds };
}

beforeEach(() => {
  vi.mocked(listChartOfAccounts).mockReset().mockResolvedValue([account()]);
  vi.mocked(getTransactionsByIds).mockReset().mockResolvedValue([transaction()]);
  // Default: every requested id comes back as actually updated (the
  // happy path) — individual tests override this to simulate the
  // Phase 25I posted-during-commit race (some requested ids NOT in the
  // returned `updatedIds`).
  vi.mocked(bulkRecodeGlAccount).mockReset().mockImplementation(async (_companyId, transactionIds) => ({ updatedIds: transactionIds }));
  vi.mocked(bulkRecodeSupplier).mockReset().mockImplementation(async (_companyId, transactionIds) => ({ updatedIds: transactionIds }));
  vi.mocked(bulkRecodeCustomer).mockReset().mockImplementation(async (_companyId, transactionIds) => ({ updatedIds: transactionIds }));
  vi.mocked(bulkRecodeVat).mockReset().mockImplementation(async (_companyId, transactionIds) => ({ updatedIds: transactionIds }));
  vi.mocked(listTransactionsForExport).mockReset().mockResolvedValue({ transactions: [], truncated: false });
  vi.mocked(getSupplier).mockReset().mockResolvedValue(supplier());
  vi.mocked(getCustomer).mockReset().mockResolvedValue(customer());
  vi.mocked(listCustomers).mockReset().mockResolvedValue([customer()]);
  vi.mocked(listVatTreatments).mockReset().mockResolvedValue([vatTreatment()]);
});

describe("GL account validation", () => {
  it("rejects a missing new GL account code", async () => {
    await expect(previewRecode("company-a", idsSelection([501]), "")).rejects.toThrow(ValidationError);
  });

  it("rejects a GL account that doesn't exist in the Chart of Accounts", async () => {
    await expect(previewRecode("company-a", idsSelection([501]), "9999")).rejects.toThrow(ValidationError);
  });

  it("rejects an inactive GL account", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue([account({ isActive: false })]);
    await expect(previewRecode("company-a", idsSelection([501]), "6200")).rejects.toThrow(ValidationError);
  });

  it("never calls getTransactionsByIds when the GL account is invalid (fails fast)", async () => {
    await expect(previewRecode("company-a", idsSelection([501]), "9999")).rejects.toThrow(ValidationError);
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });
});

describe("selection resolution — explicit ids", () => {
  it("rejects an empty id list", async () => {
    await expect(previewRecode("company-a", idsSelection([]), "6200")).rejects.toThrow(ValidationError);
  });

  it("rejects when some requested ids don't resolve (invalid or another company's)", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501 })]); // only 1 of 2 requested resolved
    await expect(previewRecode("company-a", idsSelection([501, 999]), "6200")).rejects.toThrow(ValidationError);
  });

  it("proceeds normally when every requested id resolves", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501 }), transaction({ id: 502 })]);
    const preview = await previewRecode("company-a", idsSelection([501, 502]), "6200");
    expect(preview.matchingCount).toBe(2);
  });
});

describe("selection resolution — all-matching (reuses listTransactionsForExport)", () => {
  it("passes the exact filters through", async () => {
    const filters = { search: null, dateFrom: "2026-01-01", dateTo: null, minAmount: null, maxAmount: null, statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false, unknownSupplierOnly: false, sortBy: "transactionDate" as const, sortDirection: "desc" as const };
    vi.mocked(listTransactionsForExport).mockResolvedValue({ transactions: [transaction()], truncated: false });

    await previewRecode("company-a", { mode: "all-matching", filters }, "6200");

    expect(listTransactionsForExport).toHaveBeenCalledWith("company-a", filters);
  });

  it("treats a truncated export result as exceeding the batch cap", async () => {
    vi.mocked(listTransactionsForExport).mockResolvedValue({ transactions: Array.from({ length: 100 }, (_, i) => transaction({ id: i })), truncated: true });

    await expect(previewRecode("company-a", { mode: "all-matching", filters: {} as never }, "6200")).rejects.toThrow(ValidationError);
  });
});

describe("batch cap enforcement", () => {
  it(`rejects an explicit-ids selection larger than ${MAX_RECODE_BATCH_SIZE}`, async () => {
    const many = Array.from({ length: MAX_RECODE_BATCH_SIZE + 1 }, (_, i) => transaction({ id: i }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);

    await expect(previewRecode("company-a", idsSelection(many.map((t) => t.id)), "6200")).rejects.toThrow(ValidationError);
  });

  it("allows a selection exactly at the cap", async () => {
    const atCap = Array.from({ length: MAX_RECODE_BATCH_SIZE }, (_, i) => transaction({ id: i, journalId: null }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(atCap);

    const preview = await previewRecode("company-a", idsSelection(atCap.map((t) => t.id)), "6200");
    expect(preview.matchingCount).toBe(MAX_RECODE_BATCH_SIZE);
  });

  it("never writes anything when the cap is exceeded", async () => {
    const many = Array.from({ length: MAX_RECODE_BATCH_SIZE + 1 }, (_, i) => transaction({ id: i }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);

    await expect(commitRecode("company-a", idsSelection(many.map((t) => t.id)), "6200", "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeGlAccount).not.toHaveBeenCalled();
  });
});

describe("posted-transaction protection", () => {
  it("preview separates posted (protected) transactions from eligible ones", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: null }), transaction({ id: 502, journalId: 77 })]);

    const preview = await previewRecode("company-a", idsSelection([501, 502]), "6200");

    expect(preview.matchingCount).toBe(2);
    expect(preview.eligibleCount).toBe(1);
    expect(preview.postedCount).toBe(1);
  });

  it("commit never recodes an already-posted transaction, and reports it as skipped", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: null }), transaction({ id: 502, journalId: 77 })]);

    const outcome = await commitRecode("company-a", idsSelection([501, 502]), "6200", "Jane Accountant");

    expect(outcome.recoded).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 502, reason: "Already posted to the General Ledger — protected from recoding." }]);
    expect(bulkRecodeGlAccount).toHaveBeenCalledWith("company-a", [501], "6200", "Jane Accountant");
  });

  it("commits nothing (no write call) when every matched transaction is already posted", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: 77 })]);

    const outcome = await commitRecode("company-a", idsSelection([501]), "6200", "Jane Accountant");

    expect(outcome.recoded).toBe(0);
    expect(bulkRecodeGlAccount).not.toHaveBeenCalled();
  });
});

describe("preview computation", () => {
  it("computes the estimated affected value from eligible transactions only", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      transaction({ id: 501, debit: 100, credit: 0, journalId: null }),
      transaction({ id: 502, debit: 0, credit: 250, journalId: null }),
      transaction({ id: 503, debit: 9999, credit: 0, journalId: 77 }), // posted — excluded
    ]);

    const preview = await previewRecode("company-a", idsSelection([501, 502, 503]), "6200");

    expect(preview.estimatedAffectedValue).toBe(350);
  });

  it("groups the current-account breakdown correctly", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      transaction({ id: 501, suggestedGlAccount: "6100", debit: 100, journalId: null }),
      transaction({ id: 502, suggestedGlAccount: "6100", debit: 200, journalId: null }),
      transaction({ id: 503, suggestedGlAccount: "6300", debit: 50, journalId: null }),
    ]);

    const preview = await previewRecode("company-a", idsSelection([501, 502, 503]), "6200");

    expect(preview.currentAccountBreakdown).toEqual(
      expect.arrayContaining([
        { currentAccount: "6100", count: 2, totalValue: 300 },
        { currentAccount: "6300", count: 1, totalValue: 50 },
      ]),
    );
  });

  it("caps the sample list", async () => {
    const many = Array.from({ length: 30 }, (_, i) => transaction({ id: i, journalId: null }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);

    const preview = await previewRecode("company-a", idsSelection(many.map((t) => t.id)), "6200");

    expect(preview.sample.length).toBeLessThanOrEqual(20);
  });

  it("includes the resolved new account code/description", async () => {
    const preview = await previewRecode("company-a", idsSelection([501]), "6200");
    expect(preview.newGlAccount).toEqual({ accountCode: "6200", description: "Motor Vehicle Expenses" });
  });

  it("writes nothing — preview is read-only", async () => {
    await previewRecode("company-a", idsSelection([501]), "6200");
    expect(bulkRecodeGlAccount).not.toHaveBeenCalled();
  });
});

describe("commit — write path", () => {
  it("recodes the eligible transactions via bulkRecodeGlAccount", async () => {
    const outcome = await commitRecode("company-a", idsSelection([501]), "6200", "Jane Accountant");
    expect(bulkRecodeGlAccount).toHaveBeenCalledWith("company-a", [501], "6200", "Jane Accountant");
    expect(outcome).toEqual({ requested: 1, recoded: 1, skipped: [] });
  });

  it("re-validates the GL account at commit time, not just at preview time", async () => {
    await expect(commitRecode("company-a", idsSelection([501]), "9999", "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeGlAccount).not.toHaveBeenCalled();
  });

  it("reports a transaction posted DURING the commit (in the window between re-validation and the write itself) as skipped, not recoded (Phase 25I)", async () => {
    // The repository's own DB-level guard is what actually catches this
    // (journal_id IS NULL repeated in the UPDATE's WHERE clause) — this
    // test proves the service layer correctly reports whatever the
    // repository says it ACTUALLY updated, not what it merely requested.
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501 }), transaction({ id: 502 })]);
    vi.mocked(bulkRecodeGlAccount).mockResolvedValue({ updatedIds: [501] });

    const outcome = await commitRecode("company-a", idsSelection([501, 502]), "6200", "Jane Accountant");

    expect(outcome.recoded).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 502, reason: expect.stringContaining("Posted to the General Ledger during this commit") }]);
  });
});

describe("tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await commitRecode("company-b", idsSelection([501]), "6200", "Jane Accountant");

    expect(listChartOfAccounts).toHaveBeenCalledWith("company-b");
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(bulkRecodeGlAccount).toHaveBeenCalledWith("company-b", [501], "6200", "Jane Accountant");
  });

  it("Company A's GL account list is never used to validate a Company B request or vice versa (independent calls)", async () => {
    await commitRecode("company-a", idsSelection([501]), "6200", "Jane Accountant");
    await commitRecode("company-b", idsSelection([501]), "6200", "Jane Accountant");

    expect(listChartOfAccounts).toHaveBeenNthCalledWith(1, "company-a");
    expect(listChartOfAccounts).toHaveBeenNthCalledWith(2, "company-b");
  });
});

describe("no secrets in errors", () => {
  it("a ValidationError message never contains anything resembling a key/token", async () => {
    let caught: unknown;
    try {
      await previewRecode("company-a", idsSelection([501]), "9999");
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).not.toMatch(/service[_-]?role|api[_-]?key|secret/i);
  });
});

// =======================================================================
// Phase 25G — Supplier recode
// =======================================================================

describe("supplier recode — target validation", () => {
  it("rejects when the new supplier id doesn't resolve for this company (invalid entity)", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(previewSupplierRecode("company-a", idsSelection([501]), 999)).rejects.toThrow(ValidationError);
  });

  it("rejects a supplier belonging to another company — getSupplier is itself company-scoped, so a cross-company id simply resolves to null (cross-company entity)", async () => {
    vi.mocked(getSupplier).mockImplementation(async (companyId, supplierId) => (companyId === "company-a" ? null : supplier({ id: supplierId, companyId })));
    await expect(previewSupplierRecode("company-a", idsSelection([501]), 1)).rejects.toThrow(ValidationError);
    expect(getSupplier).toHaveBeenCalledWith("company-a", 1);
  });

  it("never resolves the transaction selection when the supplier is invalid (fails fast)", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(previewSupplierRecode("company-a", idsSelection([501]), 999)).rejects.toThrow(ValidationError);
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });

  // Phase 38 — Phase 37's production audit found `requireCompanySupplier`
  // checked existence but never status, unlike its VAT sibling
  // (`requireActiveVatTreatment`) which already rejected an inactive
  // treatment. Fixed at the one shared validation point both preview and
  // commit call through.
  it("rejects recoding to an Inactive supplier — preview", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 9, name: "Deactivated Duplicate", status: "Inactive" }));
    await expect(previewSupplierRecode("company-a", idsSelection([501]), 9)).rejects.toThrow(ValidationError);
    await expect(previewSupplierRecode("company-a", idsSelection([501]), 9)).rejects.toThrow(/inactive/i);
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });

  it("rejects recoding to an Inactive supplier — commit, and never writes", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 9, name: "Deactivated Duplicate", status: "Inactive" }));
    await expect(commitSupplierRecode("company-a", idsSelection([501]), 9, "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeSupplier).not.toHaveBeenCalled();
  });

  it("still accepts an Active supplier, unchanged", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 1, status: "Active" }));
    const preview = await previewSupplierRecode("company-a", idsSelection([501]), 1);
    expect(preview.newSupplier.id).toBe(1);
  });
});

describe("supplier recode — cross-company transaction ids (reuses existing selection resolution)", () => {
  it("rejects when a requested transaction id doesn't resolve for this company", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501 })]);
    await expect(previewSupplierRecode("company-a", idsSelection([501, 999]), 1)).rejects.toThrow(ValidationError);
  });
});

describe("supplier recode — batch cap (reuses existing enforcement)", () => {
  it(`rejects a selection larger than ${MAX_RECODE_BATCH_SIZE}, and never writes anything`, async () => {
    const many = Array.from({ length: MAX_RECODE_BATCH_SIZE + 1 }, (_, i) => transaction({ id: i }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);
    await expect(commitSupplierRecode("company-a", idsSelection(many.map((t) => t.id)), 1, "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeSupplier).not.toHaveBeenCalled();
  });
});

describe("supplier recode — posted-transaction protection", () => {
  it("preview separates posted (protected) transactions from eligible ones", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: null }), transaction({ id: 502, journalId: 77 })]);
    const preview = await previewSupplierRecode("company-a", idsSelection([501, 502]), 1);
    expect(preview.eligibleCount).toBe(1);
    expect(preview.postedCount).toBe(1);
  });

  it("commit skips already-posted transactions and reports them, without writing for them", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: null }), transaction({ id: 502, journalId: 77 })]);
    const outcome = await commitSupplierRecode("company-a", idsSelection([501, 502]), 1, "Jane Accountant");
    expect(outcome.recoded).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 502, reason: "Already posted to the General Ledger — protected from recoding." }]);
  });

  it("commits nothing (no-op) when every matched transaction is already posted", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: 77 })]);
    const outcome = await commitSupplierRecode("company-a", idsSelection([501]), 1, "Jane Accountant");
    expect(outcome.recoded).toBe(0);
    expect(bulkRecodeSupplier).not.toHaveBeenCalled();
  });
});

describe("supplier recode — preview correctness", () => {
  it("groups the current-supplier breakdown correctly, using the transaction's own denormalized supplier name", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      transaction({ id: 501, matchedSupplierId: 5, matchedSupplierName: "Old Supplier", debit: 100, journalId: null }),
      transaction({ id: 502, matchedSupplierId: 5, matchedSupplierName: "Old Supplier", debit: 200, journalId: null }),
      transaction({ id: 503, matchedSupplierId: null, matchedSupplierName: null, debit: 50, journalId: null }),
    ]);
    const preview = await previewSupplierRecode("company-a", idsSelection([501, 502, 503]), 1);
    expect(preview.currentSupplierBreakdown).toEqual(
      expect.arrayContaining([
        { currentSupplierId: 5, currentSupplierName: "Old Supplier", count: 2, totalValue: 300 },
        { currentSupplierId: null, currentSupplierName: null, count: 1, totalValue: 50 },
      ]),
    );
  });

  it("includes the resolved new supplier id/name", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 7, name: "Beta Traders" }));
    const preview = await previewSupplierRecode("company-a", idsSelection([501]), 7);
    expect(preview.newSupplier).toEqual({ id: 7, name: "Beta Traders" });
  });

  it("writes nothing — preview is read-only", async () => {
    await previewSupplierRecode("company-a", idsSelection([501]), 1);
    expect(bulkRecodeSupplier).not.toHaveBeenCalled();
  });
});

describe("supplier recode — commit write path and audit trail", () => {
  it("recodes eligible transactions via bulkRecodeSupplier with the resolved supplier id/name (audit history)", async () => {
    vi.mocked(getSupplier).mockResolvedValue(supplier({ id: 7, name: "Beta Traders" }));
    const outcome = await commitSupplierRecode("company-a", idsSelection([501]), 7, "Jane Accountant");
    expect(bulkRecodeSupplier).toHaveBeenCalledWith("company-a", [501], 7, "Beta Traders", "Jane Accountant");
    expect(outcome).toEqual({ requested: 1, recoded: 1, skipped: [] });
  });

  it("re-validates the target supplier at commit time, not just at preview time", async () => {
    vi.mocked(getSupplier).mockResolvedValue(null);
    await expect(commitSupplierRecode("company-a", idsSelection([501]), 999, "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeSupplier).not.toHaveBeenCalled();
  });
});

describe("supplier recode — tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await commitSupplierRecode("company-b", idsSelection([501]), 1, "Jane Accountant");
    expect(getSupplier).toHaveBeenCalledWith("company-b", 1);
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(bulkRecodeSupplier).toHaveBeenCalledWith("company-b", [501], expect.anything(), expect.anything(), "Jane Accountant");
  });
});

// =======================================================================
// Phase 25G — Customer recode
// =======================================================================

describe("customer recode — target validation", () => {
  it("rejects when the new customer id doesn't resolve for this company (invalid entity)", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    await expect(previewCustomerRecode("company-a", idsSelection([501]), 999)).rejects.toThrow(ValidationError);
  });

  it("rejects a customer belonging to another company — cross-company id resolves to null", async () => {
    vi.mocked(getCustomer).mockImplementation(async (companyId, customerId) => (companyId === "company-a" ? null : customer({ id: customerId, companyId })));
    await expect(previewCustomerRecode("company-a", idsSelection([501]), 1)).rejects.toThrow(ValidationError);
  });

  it("never resolves the transaction selection when the customer is invalid (fails fast)", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    await expect(previewCustomerRecode("company-a", idsSelection([501]), 999)).rejects.toThrow(ValidationError);
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });
});

describe("customer recode — batch cap and posted protection (reuses existing enforcement)", () => {
  it(`rejects a selection larger than ${MAX_RECODE_BATCH_SIZE}, and never writes anything`, async () => {
    const many = Array.from({ length: MAX_RECODE_BATCH_SIZE + 1 }, (_, i) => transaction({ id: i }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);
    await expect(commitCustomerRecode("company-a", idsSelection(many.map((t) => t.id)), 1, "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeCustomer).not.toHaveBeenCalled();
  });

  it("commit skips already-posted transactions and reports them", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: null }), transaction({ id: 502, journalId: 77 })]);
    const outcome = await commitCustomerRecode("company-a", idsSelection([501, 502]), 1, "Jane Accountant");
    expect(outcome.recoded).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 502, reason: "Already posted to the General Ledger — protected from recoding." }]);
  });

  it("commits nothing (no-op) when every matched transaction is already posted", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: 77 })]);
    const outcome = await commitCustomerRecode("company-a", idsSelection([501]), 1, "Jane Accountant");
    expect(outcome.recoded).toBe(0);
    expect(bulkRecodeCustomer).not.toHaveBeenCalled();
  });
});

describe("customer recode — preview correctness", () => {
  it("groups the current-customer breakdown, resolving names via listCustomers", async () => {
    vi.mocked(listCustomers).mockResolvedValue([customer({ id: 9, name: "Old Customer" })]);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      transaction({ id: 501, matchedCustomerId: 9, debit: 100, journalId: null }),
      transaction({ id: 502, matchedCustomerId: 9, debit: 200, journalId: null }),
      transaction({ id: 503, matchedCustomerId: null, debit: 50, journalId: null }),
    ]);
    const preview = await previewCustomerRecode("company-a", idsSelection([501, 502, 503]), 1);
    expect(preview.currentCustomerBreakdown).toEqual(
      expect.arrayContaining([
        { currentCustomerId: 9, currentCustomerName: "Old Customer", count: 2, totalValue: 300 },
        { currentCustomerId: null, currentCustomerName: null, count: 1, totalValue: 50 },
      ]),
    );
  });

  it("includes the resolved new customer id/name", async () => {
    vi.mocked(getCustomer).mockResolvedValue(customer({ id: 8, name: "Southend Retail" }));
    const preview = await previewCustomerRecode("company-a", idsSelection([501]), 8);
    expect(preview.newCustomer).toEqual({ id: 8, name: "Southend Retail" });
  });

  it("writes nothing — preview is read-only", async () => {
    await previewCustomerRecode("company-a", idsSelection([501]), 1);
    expect(bulkRecodeCustomer).not.toHaveBeenCalled();
  });
});

describe("customer recode — commit write path and audit trail", () => {
  it("recodes eligible transactions via bulkRecodeCustomer with the resolved customer id/name (audit history)", async () => {
    vi.mocked(getCustomer).mockResolvedValue(customer({ id: 8, name: "Southend Retail" }));
    const outcome = await commitCustomerRecode("company-a", idsSelection([501]), 8, "Jane Accountant");
    expect(bulkRecodeCustomer).toHaveBeenCalledWith("company-a", [501], 8, "Southend Retail", "Jane Accountant");
    expect(outcome).toEqual({ requested: 1, recoded: 1, skipped: [] });
  });

  it("re-validates the target customer at commit time, not just at preview time", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    await expect(commitCustomerRecode("company-a", idsSelection([501]), 999, "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeCustomer).not.toHaveBeenCalled();
  });
});

describe("customer recode — tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await commitCustomerRecode("company-b", idsSelection([501]), 1, "Jane Accountant");
    expect(getCustomer).toHaveBeenCalledWith("company-b", 1);
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(bulkRecodeCustomer).toHaveBeenCalledWith("company-b", [501], expect.anything(), expect.anything(), "Jane Accountant");
  });
});

// =======================================================================
// Phase 25G — VAT recode (confirmed safe by inspection: suggested_vat_code
// is informational only, never read by journal posting or VAT Return
// computation — see find-and-recode-service.ts's own docstring above
// commitVatRecode for the full reasoning).
// =======================================================================

describe("VAT recode — target validation", () => {
  it("rejects a missing new VAT code", async () => {
    await expect(previewVatRecode("company-a", idsSelection([501]), "")).rejects.toThrow(ValidationError);
  });

  it("rejects a VAT treatment that doesn't exist for this company (invalid entity)", async () => {
    await expect(previewVatRecode("company-a", idsSelection([501]), "NONEXISTENT")).rejects.toThrow(ValidationError);
  });

  it("rejects an inactive VAT treatment", async () => {
    vi.mocked(listVatTreatments).mockResolvedValue([vatTreatment({ isActive: false })]);
    await expect(previewVatRecode("company-a", idsSelection([501]), "STD")).rejects.toThrow(ValidationError);
  });

  it("never resolves the transaction selection when the VAT treatment is invalid (fails fast)", async () => {
    await expect(previewVatRecode("company-a", idsSelection([501]), "NONEXISTENT")).rejects.toThrow(ValidationError);
    expect(getTransactionsByIds).not.toHaveBeenCalled();
  });
});

describe("VAT recode — batch cap and posted protection (reuses existing enforcement)", () => {
  it(`rejects a selection larger than ${MAX_RECODE_BATCH_SIZE}, and never writes anything`, async () => {
    const many = Array.from({ length: MAX_RECODE_BATCH_SIZE + 1 }, (_, i) => transaction({ id: i }));
    vi.mocked(getTransactionsByIds).mockResolvedValue(many);
    await expect(commitVatRecode("company-a", idsSelection(many.map((t) => t.id)), "STD", "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeVat).not.toHaveBeenCalled();
  });

  it("commit skips already-posted transactions and reports them", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: null }), transaction({ id: 502, journalId: 77 })]);
    const outcome = await commitVatRecode("company-a", idsSelection([501, 502]), "STD", "Jane Accountant");
    expect(outcome.recoded).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 502, reason: "Already posted to the General Ledger — protected from recoding." }]);
  });

  it("commits nothing (no-op) when every matched transaction is already posted", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501, journalId: 77 })]);
    const outcome = await commitVatRecode("company-a", idsSelection([501]), "STD", "Jane Accountant");
    expect(outcome.recoded).toBe(0);
    expect(bulkRecodeVat).not.toHaveBeenCalled();
  });
});

describe("VAT recode — preview correctness", () => {
  it("groups the current-VAT-code breakdown correctly", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      transaction({ id: 501, suggestedVatCode: "ZERO", debit: 100, journalId: null }),
      transaction({ id: 502, suggestedVatCode: "ZERO", debit: 200, journalId: null }),
      transaction({ id: 503, suggestedVatCode: null, debit: 50, journalId: null }),
    ]);
    const preview = await previewVatRecode("company-a", idsSelection([501, 502, 503]), "STD");
    expect(preview.currentVatBreakdown).toEqual(
      expect.arrayContaining([
        { currentVatCode: "ZERO", count: 2, totalValue: 300 },
        { currentVatCode: null, count: 1, totalValue: 50 },
      ]),
    );
  });

  it("includes the resolved new VAT treatment code/name", async () => {
    vi.mocked(listVatTreatments).mockResolvedValue([vatTreatment({ code: "EXEMPT", name: "Exempt" })]);
    const preview = await previewVatRecode("company-a", idsSelection([501]), "EXEMPT");
    expect(preview.newVatTreatment).toEqual({ code: "EXEMPT", name: "Exempt" });
  });

  it("writes nothing — preview is read-only", async () => {
    await previewVatRecode("company-a", idsSelection([501]), "STD");
    expect(bulkRecodeVat).not.toHaveBeenCalled();
  });
});

describe("VAT recode — commit write path and audit trail", () => {
  it("recodes eligible transactions via bulkRecodeVat with the resolved treatment code (audit history)", async () => {
    const outcome = await commitVatRecode("company-a", idsSelection([501]), "STD", "Jane Accountant");
    expect(bulkRecodeVat).toHaveBeenCalledWith("company-a", [501], "STD", "Jane Accountant");
    expect(outcome).toEqual({ requested: 1, recoded: 1, skipped: [] });
  });

  it("re-validates the target VAT treatment at commit time, not just at preview time", async () => {
    await expect(commitVatRecode("company-a", idsSelection([501]), "NONEXISTENT", "Jane Accountant")).rejects.toThrow(ValidationError);
    expect(bulkRecodeVat).not.toHaveBeenCalled();
  });

  it("reports a transaction posted DURING the commit as skipped, not recoded (Phase 25I, same guard as GL recode)", async () => {
    vi.mocked(getTransactionsByIds).mockResolvedValue([transaction({ id: 501 }), transaction({ id: 502 })]);
    vi.mocked(bulkRecodeVat).mockResolvedValue({ updatedIds: [501] });

    const outcome = await commitVatRecode("company-a", idsSelection([501, 502]), "STD", "Jane Accountant");

    expect(outcome.recoded).toBe(1);
    expect(outcome.skipped).toEqual([{ transactionId: 502, reason: expect.stringContaining("Posted to the General Ledger during this commit") }]);
  });
});

describe("VAT recode — tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await commitVatRecode("company-b", idsSelection([501]), "STD", "Jane Accountant");
    expect(listVatTreatments).toHaveBeenCalledWith("company-b");
    expect(getTransactionsByIds).toHaveBeenCalledWith("company-b", [501]);
    expect(bulkRecodeVat).toHaveBeenCalledWith("company-b", [501], "STD", "Jane Accountant");
  });
});
