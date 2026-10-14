/**
 * `assignMissingLineAccounts` — the supported repair for Draft invoices
 * imported without an account. Every dependency is mocked; this never
 * touches a real Supabase project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/sales-invoice-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/repositories/sales-invoice-repository")>()),
  getSalesInvoice: vi.fn(),
  setMissingLineAccounts: vi.fn(),
  clearLineAccounts: vi.fn(),
}));
vi.mock("@/server/repositories/chart-of-accounts-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/repositories/chart-of-accounts-repository")>()),
  listChartOfAccounts: vi.fn(),
}));
vi.mock("@/server/services/automation-audit-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/automation-audit-service")>()),
  recordAuditEntry: vi.fn(),
}));

import { assignMissingLineAccounts, ValidationError } from "./sales-invoice-service";
import { clearLineAccounts, getSalesInvoice, setMissingLineAccounts } from "@/server/repositories/sales-invoice-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const CO = "company-a";

function line(id: number, glAccount: string | null): SalesInvoiceLine {
  return { id, invoiceId: 501, lineOrder: id, description: `Line ${id}`, quantity: 2, unitPrice: 50, lineTotal: 115, stockItemId: null, glAccount, vatCode: "Standard Rated" } as SalesInvoiceLine;
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 501, companyId: CO, documentType: "Invoice", invoiceNumber: "SI-01667102", customerId: 7, invoiceDate: "2026-08-25", dueDate: "2026-08-25",
    reference: "VOLORA abc", status: "Draft", subtotal: 200, vatAmount: 30, total: 230, outstanding: 230, notes: "", journalId: null,
    lines: [line(1, null), line(2, null), line(3, "1005")],
    ...overrides,
  } as SalesInvoice;
}

const account = (code: string, overrides: Partial<ChartOfAccount> = {}) =>
  ({ id: Number(code), companyId: CO, accountCode: code, description: code === "1000" ? "Product Sales" : `Account ${code}`, accountType: "Income", isActive: true, ...overrides }) as ChartOfAccount;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSalesInvoice).mockResolvedValue(invoice());
  vi.mocked(listChartOfAccounts).mockResolvedValue([account("1000"), account("1500", { accountType: "Cost of Sales" }), account("1010", { isActive: false })]);
  vi.mocked(setMissingLineAccounts).mockImplementation(async (_id, ids) => ids);
  vi.mocked(recordAuditEntry).mockResolvedValue({} as never);
});

describe("assignMissingLineAccounts", () => {
  it("fills only the lines without an account, records an audit entry, and leaves totals and VAT unchanged", async () => {
    const result = await assignMissingLineAccounts(CO, 501, "1000", "owner@example.test");

    expect(setMissingLineAccounts).toHaveBeenCalledWith(501, [1, 2], "1000");
    expect(recordAuditEntry).toHaveBeenCalledWith(CO, expect.objectContaining({
      performedBy: "owner@example.test",
      actionType: "SalesInvoiceLineAccountsAssigned",
      documentType: "SalesInvoice",
      documentId: 501,
      changes: expect.objectContaining({ glAccount: "1000", lineIds: [1, 2], previousGlAccount: null, totals: { subtotal: 200, vatAmount: 30, total: 230 } }),
    }));
    expect(result).toMatchObject({ subtotal: 200, vatAmount: 30, total: 230, status: "Draft" });
    expect(clearLineAccounts).not.toHaveBeenCalled();
  });

  it.each(["Submitted", "Approved", "Posted", "Cancelled"] as const)("refuses a %s invoice and changes nothing", async (status) => {
    vi.mocked(getSalesInvoice).mockResolvedValue(invoice({ status }));
    await expect(assignMissingLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(ValidationError);
    expect(setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ["9999", /not in the chart of accounts/],
    ["1010", /is inactive/],
    ["1500", /Cost of Sales; a sales line needs an Income account/],
    ["", /not in the chart of accounts/],
  ])("refuses account %j", async (code, message) => {
    await expect(assignMissingLineAccounts(CO, 501, code, "x")).rejects.toThrow(message);
    expect(setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it("refuses when every line already has an account (it never re-codes a line)", async () => {
    vi.mocked(getSalesInvoice).mockResolvedValue(invoice({ lines: [line(1, "1000"), line(2, "1005")] }));
    await expect(assignMissingLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/already has an account/);
    expect(setMissingLineAccounts).not.toHaveBeenCalled();
  });

  it("undoes the change when the audit entry cannot be recorded", async () => {
    vi.mocked(recordAuditEntry).mockRejectedValue(new Error("audit unavailable"));
    await expect(assignMissingLineAccounts(CO, 501, "1000", "x")).rejects.toThrow("audit unavailable");
    expect(clearLineAccounts).toHaveBeenCalledWith(501, [1, 2], "1000");
  });

  it("refuses when the totals differ afterwards", async () => {
    vi.mocked(getSalesInvoice).mockResolvedValueOnce(invoice()).mockResolvedValueOnce(invoice({ total: 231 }));
    await expect(assignMissingLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/Totals of SI-01667102 changed/);
  });

  it("reports when nothing was changed (someone else got there first)", async () => {
    vi.mocked(setMissingLineAccounts).mockResolvedValue([]);
    await expect(assignMissingLineAccounts(CO, 501, "1000", "x")).rejects.toThrow(/No line on SI-01667102 was changed/);
    expect(recordAuditEntry).not.toHaveBeenCalled();
  });
});
