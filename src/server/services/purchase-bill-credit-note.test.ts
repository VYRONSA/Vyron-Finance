/**
 * SD-1 — verification of the EXISTING supplier credit-note path, before
 * Supplier Invoice Capture was allowed to use it.
 *
 * Nothing here is new behaviour. These tests pin what `createPurchaseBill`
 * and `approveAndPostBill` already do with a "Credit Note", so that capture
 * can rely on it and any future change to it is noticed:
 *
 *  - a credit note is stored with POSITIVE amounts and its document type;
 *  - it is approved only from Submitted, through the same workflow as a bill;
 *  - approval resolves the seeded "Supplier Credit Note" posting rule
 *    (0007: DR Creditors 2000 gross / CR expense net / CR VAT Input 2100 vat)
 *    — the exact reversal of "Supplier Invoice" — and never "Inventory Bill",
 *    even against a stock-carrying order;
 *  - the journal is balanced and posts through the one Posting Engine.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedBill, PurchaseBillLine } from "@/server/accounting/types";

const repo = {
  getPurchaseBill: vi.fn(),
  listPurchaseBillLines: vi.fn(),
  createPurchaseBillWithLines: vi.fn(),
  approveBill: vi.fn(),
  markBillPosted: vi.fn(),
};
const createJournal = vi.fn();
const getPostingRuleByEventType = vi.fn();
const postApprovedJournals = vi.fn();
const getPurchaseOrder = vi.fn();

vi.mock("@/server/repositories/purchase-bill-repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...repo,
}));
vi.mock("@/server/repositories/journal-repository", () => ({ createJournal: (...a: unknown[]) => createJournal(...a) }));
vi.mock("@/server/repositories/posting-rule-repository", () => ({
  getPostingRuleByEventType: (...a: unknown[]) => getPostingRuleByEventType(...a),
}));
vi.mock("@/server/repositories/purchase-order-repository", () => ({ getPurchaseOrder: (...a: unknown[]) => getPurchaseOrder(...a) }));
vi.mock("@/server/repositories/goods-received-note-repository", () => ({ getGoodsReceivedNote: vi.fn(), listGoodsReceivedNotes: vi.fn() }));
vi.mock("@/server/repositories/supplier-reconciliation-repository", () => ({ listAllBills: vi.fn() }));
vi.mock("@/server/services/supplier-management-service", () => ({ getSupplier: async () => ({ id: 7, name: "Karoo Wholesale Supplies" }) }));
vi.mock("@/server/services/posting-rule-service", () => ({ buildJournalFromEvent: vi.fn() }));
vi.mock("@/server/services/posting-engine-service", () => ({ postApprovedJournals: (...a: unknown[]) => postApprovedJournals(...a) }));
vi.mock("@/server/services/vat-treatment-service", () => ({
  listVatTreatments: async () => [{ code: "Standard Rated", rate: 15 }, { code: "Zero Rated", rate: 0 }],
}));

/** The seeded 0007 rules, line for line. */
const RULES: Record<string, { isActive: boolean; lines: { side: "Debit" | "Credit"; fixedAccountCode: string | null; amountSource: "gross" | "net" | "vat" }[] }> = {
  "Supplier Invoice": {
    isActive: true,
    lines: [
      { side: "Debit", fixedAccountCode: null, amountSource: "net" },
      { side: "Debit", fixedAccountCode: "2100", amountSource: "vat" },
      { side: "Credit", fixedAccountCode: "2000", amountSource: "gross" },
    ],
  },
  "Supplier Credit Note": {
    isActive: true,
    lines: [
      { side: "Debit", fixedAccountCode: "2000", amountSource: "gross" },
      { side: "Credit", fixedAccountCode: null, amountSource: "net" },
      { side: "Credit", fixedAccountCode: "2100", amountSource: "vat" },
    ],
  },
};

function bill(overrides: Partial<ImportedBill> = {}): ImportedBill {
  return {
    id: 42,
    companyId: "co_1",
    supplierId: 7,
    supplierName: "Karoo Wholesale Supplies",
    invoiceNumber: "KW-CN-0007",
    documentType: "Credit Note",
    invoiceDate: "2026-06-12",
    dueDate: null,
    vat: 150,
    total: 1150,
    outstanding: 1150,
    postingStatus: "Submitted",
    purchaseOrderId: null,
    journalId: null,
    vatCode: "Standard Rated",
    ...overrides,
  } as ImportedBill;
}

function billLine(overrides: Partial<PurchaseBillLine> = {}): PurchaseBillLine {
  return {
    id: 1, companyId: "co_1", billId: 42, lineOrder: 0, description: "Returned stock — damaged", glAccount: "5100",
    vatCode: "Standard Rated", costCentreId: null, projectId: null, departmentId: null,
    quantity: 10, unitCost: 100, discount: 0, netAmount: 1000, vatAmount: 150, lineTotal: 1150,
    createdAt: "2026-06-12T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getPostingRuleByEventType.mockImplementation(async (_c: string, eventType: string) => RULES[eventType] ?? null);
  createJournal.mockResolvedValue({ id: 900 });
  repo.approveBill.mockResolvedValue(undefined);
  postApprovedJournals.mockResolvedValue({ posted: [{ journalId: 900 }], skipped: [] });
  repo.markBillPosted.mockImplementation(async () => bill({ postingStatus: "Posted", journalId: 900 }));
  repo.createPurchaseBillWithLines.mockImplementation(async (_c: string, header: unknown, vat: number, total: number) => ({ bill: { ...bill(), header, vat, total } }));
});

describe("creating a supplier credit note (the path capture now uses)", () => {
  it("stores it as a Credit Note with POSITIVE amounts — the type carries the sign", async () => {
    const { createPurchaseBill } = await import("./purchase-bill-service");
    await createPurchaseBill("co_1", {
      supplierId: 7,
      invoiceNumber: "KW-CN-0007",
      documentType: "Credit Note",
      invoiceDate: "2026-06-12",
      lines: [{ description: "Returned stock — damaged", glAccount: "5100", vatCode: "Standard Rated", quantity: 10, unitCost: 100 }],
    });
    const [, header, vat, total] = repo.createPurchaseBillWithLines.mock.calls[0];
    expect((header as { documentType: string }).documentType).toBe("Credit Note");
    expect(vat).toBe(150);
    expect(total).toBe(1150);
  });

  it("previews exactly the totals creation computes (the SD-1 approval amount source)", async () => {
    const { previewPurchaseBillTotals } = await import("./purchase-bill-service");
    const totals = await previewPurchaseBillTotals("co_1", [
      { description: "a", glAccount: "5100", vatCode: "Standard Rated", quantity: 10, unitCost: 100 },
      { description: "b", glAccount: "5200", vatCode: "Zero Rated", quantity: 1, unitCost: 50, discount: 5 },
    ]);
    expect(totals).toEqual({ subtotal: 1045, vat: 150, total: 1195 });
  });

  it("refuses to preview nothing, rather than reporting a zero total", async () => {
    const { previewPurchaseBillTotals } = await import("./purchase-bill-service");
    await expect(previewPurchaseBillTotals("co_1", [])).rejects.toThrow(/at least one line/i);
  });
});

describe("approving a supplier credit note reverses a bill through the existing rule", () => {
  it("resolves 'Supplier Credit Note' and posts DR Creditors / CR expense / CR VAT Input", async () => {
    repo.getPurchaseBill.mockResolvedValue(bill());
    repo.listPurchaseBillLines.mockResolvedValue([billLine()]);
    const { approveAndPostBill } = await import("./purchase-bill-service");
    await approveAndPostBill("co_1", 42);

    expect(getPostingRuleByEventType).toHaveBeenCalledWith("co_1", "Supplier Credit Note");
    const journal = createJournal.mock.calls[0][1] as { journalType: string; sourceType: string; status: string; lines: { accountCode: string; debit: number; credit: number }[] };
    expect(journal.journalType).toBe("Credit Note");
    expect(journal.sourceType).toBe("purchase_bill");
    expect(journal.status).toBe("Approved");
    expect(journal.lines.map(({ accountCode, debit, credit }) => ({ accountCode, debit, credit }))).toEqual([
      { accountCode: "2000", debit: 1150, credit: 0 },
      { accountCode: "5100", debit: 0, credit: 1000 },
      { accountCode: "2100", debit: 0, credit: 150 },
    ]);
    const debits = journal.lines.reduce((s, l) => s + l.debit, 0);
    const credits = journal.lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBe(credits);
    expect(postApprovedJournals).toHaveBeenCalledWith("co_1");
  });

  it("is the exact mirror of the same document approved as a Bill", async () => {
    repo.listPurchaseBillLines.mockResolvedValue([billLine()]);
    const { approveAndPostBill } = await import("./purchase-bill-service");

    repo.getPurchaseBill.mockResolvedValue(bill({ documentType: "Bill", invoiceNumber: "KW-10041" }));
    await approveAndPostBill("co_1", 42);
    repo.getPurchaseBill.mockResolvedValue(bill());
    await approveAndPostBill("co_1", 42);

    const net = (call: unknown[]) =>
      Object.fromEntries((call[1] as { lines: { accountCode: string; debit: number; credit: number }[] }).lines.map((l) => [l.accountCode, l.debit - l.credit]));
    const asBill = net(createJournal.mock.calls[0]);
    const asCredit = net(createJournal.mock.calls[1]);
    for (const account of Object.keys(asBill)) expect(asCredit[account]).toBe(-asBill[account]);
  });

  it("never becomes an 'Inventory Bill', even against an order carrying stock", async () => {
    repo.getPurchaseBill.mockResolvedValue(bill({ purchaseOrderId: 3 }));
    repo.listPurchaseBillLines.mockResolvedValue([billLine()]);
    getPurchaseOrder.mockResolvedValue({ lines: [{ stockItemId: 11 }] });
    const { approveAndPostBill } = await import("./purchase-bill-service");
    await approveAndPostBill("co_1", 42);
    expect(getPostingRuleByEventType).toHaveBeenCalledWith("co_1", "Supplier Credit Note");
    expect(getPostingRuleByEventType).not.toHaveBeenCalledWith("co_1", "Inventory Bill");
  });

  it("cannot be approved from Draft — it goes through Submit first, like any bill", async () => {
    repo.getPurchaseBill.mockResolvedValue(bill({ postingStatus: "Draft" }));
    const { approveAndPostBill, ValidationError } = await import("./purchase-bill-service");
    await expect(approveAndPostBill("co_1", 42)).rejects.toBeInstanceOf(ValidationError);
    expect(createJournal).not.toHaveBeenCalled();
  });
});
