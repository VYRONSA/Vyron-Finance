/**
 * PRODUCTION DEFECT — "still gives error of no invoices, even if No
 * Invoice is ticked."
 *
 * The accountant ticked "Override Supplier Invoice Matching" on two
 * Northwood supplier payments, pressed the commit button, saw "2
 * allocations updated successfully" — and the posting preflight still
 * refused both for having no supplier invoice. Reading the two rows
 * straight out of production showed why:
 * `override_supplier_invoice_matching` was still `false`, and
 * `..._by`/`..._at` were still null. The override had never been written.
 *
 * The field was accepted by the route, declared on `AllocateRowInput`,
 * and written by the repository — and dropped in between, because
 * `allocateRow` in the service builds its repository payload field by
 * field and this one was simply never added to that object. TypeScript
 * could not catch it while the property was optional: omitting an
 * optional property is not an error.
 *
 * So this file pins the FORWARDING itself, not just the endpoints. The
 * property is now required on `AllocateRowInput`, which makes the same
 * omission a compile error — these tests are the runtime half of that.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { allocateRow, type AllocateRowInput } from "@/server/services/transaction-explorer-service";

const allocateRowSpy = vi.fn(async () => ({ updatedIds: [1], blockedIds: [] }));

// Partial mocks: the service re-exports much of each repository, so every
// mock spreads the real module and replaces only what this test drives.
vi.mock("@/server/repositories/transaction-explorer-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  allocateRow: (...args: unknown[]) => allocateRowSpy(...(args as [])),
  isDuplicateNaturalKey: () => false,
}));

vi.mock("@/server/repositories/supplier-reconciliation-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSupplier: async (_c: string, id: number) => ({ id, name: "Three Streams Smokehouse", status: "Active" }),
}));

vi.mock("@/server/repositories/customer-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCustomer: async (_c: string, id: number) => ({ id, name: "A Customer" }),
}));

vi.mock("@/server/repositories/chart-of-accounts-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listChartOfAccounts: async () => [{ accountCode: "3030", description: "Bank Charges" }],
}));

vi.mock("@/server/repositories/vat-treatment-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listVatTreatments: async () => [{ code: "Standard Rated" }],
}));

function input(overrides: Partial<AllocateRowInput> = {}): AllocateRowInput {
  return {
    type: "S",
    accountCode: null,
    supplierId: 639,
    customerId: null,
    vatCode: null,
    allocationNotes: "",
    description: null,
    overrideSupplierInvoiceMatching: null,
    ...overrides,
  };
}

/** What the repository was actually asked to write. */
function writtenPayload(): Record<string, unknown> {
  expect(allocateRowSpy).toHaveBeenCalled();
  return (allocateRowSpy.mock.calls[0] as unknown as unknown[])[2] as Record<string, unknown>;
}

beforeEach(() => {
  allocateRowSpy.mockClear();
});

describe("the override reaches the repository", () => {
  it("true is forwarded — the exact case that silently did nothing in production", async () => {
    await allocateRow("co_1", [1889], input({ overrideSupplierInvoiceMatching: true }), "accountant@vyron");
    expect(writtenPayload().overrideSupplierInvoiceMatching).toBe(true);
  });

  it("false is forwarded — turning an override back off must also be written", async () => {
    await allocateRow("co_1", [1889], input({ overrideSupplierInvoiceMatching: false }), "accountant@vyron");
    expect(writtenPayload().overrideSupplierInvoiceMatching).toBe(false);
  });

  it("null is forwarded as null — 'unchanged, leave whatever is stored alone'", async () => {
    await allocateRow("co_1", [1889], input({ overrideSupplierInvoiceMatching: null }), "accountant@vyron");
    expect(writtenPayload()).toHaveProperty("overrideSupplierInvoiceMatching", null);
  });

  it("the property is always present, never dropped from the payload", async () => {
    // The defect was an ABSENT key, not a wrong value — `toHaveProperty`
    // is the assertion that would have caught it.
    await allocateRow("co_1", [1889], input({ overrideSupplierInvoiceMatching: true }), "accountant@vyron");
    expect(Object.keys(writtenPayload())).toContain("overrideSupplierInvoiceMatching");
  });

  it("forwards alongside a GL allocation too, not only a supplier one", async () => {
    await allocateRow("co_1", [1], input({ type: "G", accountCode: "3030", supplierId: null, overrideSupplierInvoiceMatching: true }), "accountant@vyron");
    expect(writtenPayload().overrideSupplierInvoiceMatching).toBe(true);
  });

  it("every other allocation field still arrives unchanged", async () => {
    await allocateRow(
      "co_1",
      [1889],
      input({ vatCode: "Standard Rated", allocationNotes: "on account", description: "Corrected narration", overrideSupplierInvoiceMatching: true }),
      "accountant@vyron",
    );
    expect(writtenPayload()).toMatchObject({
      type: "S",
      supplierId: 639,
      customerId: null,
      vatCode: "Standard Rated",
      allocationNotes: "on account",
      description: "Corrected narration",
      overrideSupplierInvoiceMatching: true,
    });
  });

  it("the override never invents an invoice, a bill or a match", async () => {
    await allocateRow("co_1", [1889], input({ overrideSupplierInvoiceMatching: true }), "accountant@vyron");
    const payload = writtenPayload();
    for (const forbidden of ["matchedBillId", "billId", "invoiceId", "matchedSupplierId"]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });
});
