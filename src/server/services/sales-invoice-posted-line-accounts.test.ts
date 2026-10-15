/**
 * `assignMissingPostedLineAccounts` — the metadata-only repair for Posted
 * invoices whose lines have no account (Batch 1B of the Handcrafted Food
 * Products migration). Proves it can write nothing but `gl_account` of
 * empty lines, never touches a journal, and undoes itself if anything
 * else is seen to change. Every dependency is mocked; this never touches
 * a real Supabase project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/sales-invoice-repository");
vi.mock("@/server/repositories/journal-repository");
vi.mock("@/server/repositories/sales-order-repository");
vi.mock("@/server/repositories/stock-item-repository");
vi.mock("@/server/repositories/inventory-transaction-repository");
vi.mock("@/server/services/posting-rule-service");
vi.mock("@/server/services/posting-engine-service");
vi.mock("@/server/services/inventory-transaction-service");
vi.mock("@/server/repositories/chart-of-accounts-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/repositories/chart-of-accounts-repository")>()),
  listChartOfAccounts: vi.fn(),
}));
vi.mock("@/server/services/automation-audit-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/automation-audit-service")>()),
  recordAuditEntry: vi.fn(),
}));

import { assignMissingPostedLineAccounts, ValidationError } from "./sales-invoice-service";
import * as invoiceRepo from "@/server/repositories/sales-invoice-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as orderRepo from "@/server/repositories/sales-order-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import * as inventoryRepo from "@/server/repositories/inventory-transaction-repository";
import * as postingRules from "@/server/services/posting-rule-service";
import * as postingEngine from "@/server/services/posting-engine-service";
import * as inventoryService from "@/server/services/inventory-transaction-service";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { Journal } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const CO = "company-a";

function line(id: number, glAccount: string | null, overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    id, invoiceId: 501, lineOrder: id, description: `Line ${id}`, quantity: 2, unitPrice: 50, discount: 0,
    netAmount: 100, vatAmount: 15, lineTotal: 115, stockItemId: null, glAccount, vatCode: "Standard Rated", ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 501, companyId: CO, documentType: "Invoice", invoiceNumber: "SI-01667102", customerId: 7, invoiceDate: "2026-08-25", dueDate: "2026-08-25",
    reference: "VOLORA abc", status: "Posted", subtotal: 200, vatAmount: 30, total: 230, outstanding: 230, notes: "", journalId: 1497,
    postedAt: "2026-10-15T06:10:23Z",
    lines: [line(1, null), line(2, null), line(3, "1005")],
    ...overrides,
  } as SalesInvoice;
}

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 1497, companyId: CO, journalNumber: "JR001389", journalDate: "2026-08-25", journalType: "Invoice", description: "Invoice SI-01667102",
    reference: "VOLORA abc", sourceType: "sales_invoice", sourceId: 501, status: "Posted", totalDebit: 230, totalCredit: 230,
    createdAt: "2026-10-15T06:10:22Z", postedAt: "2026-10-15T06:10:23Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, cancelledBy: null, cancelledAt: null, isReversed: false, reversalOfJournalId: null, reversedByJournalId: null,
    postingBatchId: 896,
    lines: [
      { id: 1, journalId: 1497, accountCode: "1100", debit: 230, credit: 0, description: "", lineOrder: 1 },
      { id: 2, journalId: 1497, accountCode: "4000", debit: 0, credit: 200, description: "", lineOrder: 2 },
      { id: 3, journalId: 1497, accountCode: "2200", debit: 0, credit: 30, description: "", lineOrder: 3 },
    ],
    ...overrides,
  };
}

const account = (code: string, overrides: Partial<ChartOfAccount> = {}) =>
  ({ id: Number(code), companyId: CO, accountCode: code, description: code === "1000" ? "Product Sales" : `Account ${code}`, accountType: "Income", isActive: true, ...overrides }) as ChartOfAccount;

/** The invoice as read back after the write: lines 1 and 2 now on 1000. */
const repaired = (overrides: Partial<SalesInvoice> = {}) => invoice({ lines: [line(1, "1000"), line(2, "1000"), line(3, "1005")], ...overrides });

/** Every exported function of a mocked module that was called, except the allowed ones. */
function calledExcept(mod: Record<string, unknown>, allowed: string[]): string[] {
  return Object.entries(mod)
    .filter(([name, fn]) => !allowed.includes(name) && vi.isMockFunction(fn) && fn.mock.calls.length > 0)
    .map(([name]) => name);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValueOnce(invoice()).mockResolvedValue(repaired());
  vi.mocked(journalRepo.getJournal).mockResolvedValue(journal());
  vi.mocked(listChartOfAccounts).mockResolvedValue([account("1000"), account("1005"), account("1500", { accountType: "Cost of Sales" })]);
  vi.mocked(invoiceRepo.setMissingLineAccounts).mockImplementation(async (_id, ids) => ids);
  vi.mocked(recordAuditEntry).mockResolvedValue({} as never);
});

describe("assignMissingPostedLineAccounts", () => {
  it("fills only the lines without an account with 1000 and audits the journal it left alone", async () => {
    const result = await assignMissingPostedLineAccounts(CO, 501, "1000", "owner@example.test");

    expect(invoiceRepo.setMissingLineAccounts).toHaveBeenCalledTimes(1);
    expect(invoiceRepo.setMissingLineAccounts).toHaveBeenCalledWith(501, [1, 2], "1000");
    expect(recordAuditEntry).toHaveBeenCalledWith(CO, expect.objectContaining({
      performedBy: "owner@example.test",
      actionType: "SalesInvoicePostedLineAccountsAssigned",
      documentType: "SalesInvoice",
      documentId: 501,
      journalIds: [1497],
      changes: expect.objectContaining({
        glAccount: "1000",
        lineIds: [1, 2],
        previousGlAccount: null,
        totals: { subtotal: 200, vatAmount: 30, total: 230, outstanding: 230 },
        journal: expect.objectContaining({ id: 1497, journalNumber: "JR001389", status: "Posted", totalDebit: 230, totalCredit: 230 }),
      }),
    }));
    expect(result).toMatchObject({ status: "Posted", journalId: 1497, subtotal: 200, vatAmount: 30, total: 230, outstanding: 230 });
    expect(invoiceRepo.clearLineAccounts).not.toHaveBeenCalled();
  });

  it("creates, posts, reverses or edits no accounting entry and writes nothing but the line accounts", async () => {
    await assignMissingPostedLineAccounts(CO, 501, "1000", "x");

    expect(calledExcept(journalRepo, ["getJournal"])).toEqual([]);
    expect(calledExcept(invoiceRepo, ["getSalesInvoice", "setMissingLineAccounts"])).toEqual([]);
    expect(calledExcept(postingEngine, [])).toEqual([]);
    expect(calledExcept(postingRules, [])).toEqual([]);
    expect(calledExcept(inventoryService, [])).toEqual([]);
    expect(calledExcept(inventoryRepo, [])).toEqual([]);
    expect(calledExcept(orderRepo, [])).toEqual([]);
    expect(calledExcept(itemRepo, [])).toEqual([]);
  });

  it.each(["Draft", "Submitted", "Approved", "Cancelled"] as const)("refuses a %s invoice and changes nothing", async (status) => {
    vi.mocked(invoiceRepo.getSalesInvoice).mockReset().mockResolvedValue(invoice({ status, journalId: null }));
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/only for Posted invoices/);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each(["Credit Note", "Debit Note"] as const)("refuses a Posted %s", async (documentType) => {
    vi.mocked(invoiceRepo.getSalesInvoice).mockReset().mockResolvedValue(invoice({ documentType }));
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(ValidationError);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ["1005", /Only account 1000/],
    ["4000", /Only account 1000/],
    ["", /Only account 1000/],
  ])("refuses any account but 1000 (%j), even an active Income one", async (code, message) => {
    await expect(assignMissingPostedLineAccounts(CO, 501, code, "x")).rejects.toThrow(message);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each([
    [[account("1000", { isActive: false })], /is inactive/],
    [[account("1000", { accountType: "Cost of Sales" })], /a sales line needs an Income account/],
    [[account("1005")], /not in the chart of accounts/],
  ])("refuses 1000 when it is not an active Income account", async (chart, message) => {
    vi.mocked(listChartOfAccounts).mockResolvedValue(chart);
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(message);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ["no journal at all", null],
    ["a journal of another document", journal({ sourceId: 999 })],
    ["a journal of another source type", journal({ sourceType: "manual" })],
    ["an Approved, unposted journal", journal({ status: "Approved" })],
    ["a reversed journal", journal({ isReversed: true, reversedByJournalId: 2000 })],
  ])("refuses an invoice with %s", async (_label, j) => {
    vi.mocked(journalRepo.getJournal).mockResolvedValue(j);
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(ValidationError);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it("refuses when every line already has an account (it never re-codes a line)", async () => {
    vi.mocked(invoiceRepo.getSalesInvoice).mockReset().mockResolvedValue(invoice({ lines: [line(1, "1005"), line(2, "4000")] }));
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/already has an account/);
    expect(invoiceRepo.setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each<[string, () => void]>([
    ["the invoice total", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ total: 231 }))],
    ["the invoice VAT", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ vatAmount: 31 }))],
    ["the amount outstanding", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ outstanding: 0 }))],
    ["the invoice status", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ status: "Approved" }))],
    ["the invoice's journal id", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ journalId: 1498 }))],
    ["a line's VAT", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ lines: [line(1, "1000", { vatAmount: 16 }), line(2, "1000"), line(3, "1005")] }))],
    ["a line's VAT code", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ lines: [line(1, "1000", { vatCode: "Zero Rated" }), line(2, "1000"), line(3, "1005")] }))],
    ["a line that already had an account", () => vi.mocked(invoiceRepo.getSalesInvoice).mockResolvedValue(repaired({ lines: [line(1, "1000"), line(2, "1000"), line(3, "1000")] }))],
    ["the journal status", () => vi.mocked(journalRepo.getJournal).mockResolvedValueOnce(journal()).mockResolvedValue(journal({ status: "Cancelled" }))],
    ["a journal line's account", () => vi.mocked(journalRepo.getJournal).mockResolvedValueOnce(journal()).mockResolvedValue(journal({ lines: journal().lines.map((l) => (l.accountCode === "4000" ? { ...l, accountCode: "1000" } : l)) }))],
    ["a journal line's amount", () => vi.mocked(journalRepo.getJournal).mockResolvedValueOnce(journal()).mockResolvedValue(journal({ lines: journal().lines.map((l) => (l.id === 3 ? { ...l, credit: 31 } : l)) }))],
    ["the journal date", () => vi.mocked(journalRepo.getJournal).mockResolvedValueOnce(journal()).mockResolvedValue(journal({ journalDate: "2026-10-15" }))],
    ["the journal being reversed", () => vi.mocked(journalRepo.getJournal).mockResolvedValueOnce(journal()).mockResolvedValue(journal({ isReversed: true }))],
    ["the journal disappearing", () => vi.mocked(journalRepo.getJournal).mockResolvedValueOnce(journal()).mockResolvedValue(null)],
  ])("undoes the change, records nothing and fails if %s differs afterwards", async (_label, arrange) => {
    arrange();
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/changed while assigning accounts; the change was undone/);
    expect(invoiceRepo.clearLineAccounts).toHaveBeenCalledWith(501, [1, 2], "1000");
    expect(recordAuditEntry).not.toHaveBeenCalled();
  });

  it("undoes the change when the audit entry cannot be recorded", async () => {
    vi.mocked(recordAuditEntry).mockRejectedValue(new Error("audit unavailable"));
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow("audit unavailable");
    expect(invoiceRepo.clearLineAccounts).toHaveBeenCalledWith(501, [1, 2], "1000");
  });

  it("reports when nothing was changed (someone else got there first) and records nothing", async () => {
    vi.mocked(invoiceRepo.setMissingLineAccounts).mockResolvedValue([]);
    await expect(assignMissingPostedLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/No line on SI-01667102 was changed/);
    expect(recordAuditEntry).not.toHaveBeenCalled();
    expect(invoiceRepo.clearLineAccounts).not.toHaveBeenCalled();
  });
});
