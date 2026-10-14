/**
 * Regression: imported invoice lines keep their account, a file with a
 * missing or invalid account is refused before anything is written, and a
 * re-import never duplicates an invoice.
 *
 * Batch 1B of the Handcrafted Food Products migration was uploaded from an
 * older file whose AccountCode column was blank: 43 Draft invoices landed
 * with no account on all 132 lines. Every dependency is mocked; this never
 * touches a real Supabase project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const query: Record<string, unknown> = {};
    query.update = (values: Record<string, unknown>) => {
      updates.push(values);
      return query;
    };
    query.eq = () => query;
    query.then = (resolve: (v: { error: null }) => unknown) => resolve({ error: null });
    return { from: () => query };
  }),
}));
vi.mock("@/server/services/customer-service", () => ({ createCustomer: vi.fn(), ValidationError: class extends Error {} }));
vi.mock("@/server/repositories/customer-repository", () => ({ listCustomers: vi.fn(), createCustomerAddress: vi.fn(), createCustomerContact: vi.fn() }));
vi.mock("@/server/services/supplier-management-service", () => ({ createSupplier: vi.fn(), ValidationError: class extends Error {} }));
vi.mock("@/server/repositories/supplier-management-repository", () => ({ createSupplierAddress: vi.fn(), createSupplierContact: vi.fn() }));
vi.mock("@/server/repositories/supplier-reconciliation-repository", () => ({ findSupplierByName: vi.fn(), listSuppliers: vi.fn() }));
vi.mock("@/server/repositories/sales-invoice-repository", () => ({ createSalesInvoice: vi.fn(), listSalesInvoices: vi.fn() }));
vi.mock("@/server/repositories/purchase-bill-repository", () => ({ createPurchaseBillWithLines: vi.fn(), listPurchaseBillsBySupplier: vi.fn() }));
vi.mock("@/server/repositories/chart-of-accounts-repository", () => ({ listChartOfAccounts: vi.fn(), createChartOfAccount: vi.fn(), updateChartOfAccount: vi.fn() }));
vi.mock("@/server/repositories/bank-account-repository", () => ({ createBankAccount: vi.fn(), findBankAccountByNumber: vi.fn() }));
vi.mock("@/server/repositories/import-repository", () => ({ ingestBankTransactionIdempotent: vi.fn() }));
vi.mock("@/server/import-centre/import-source-occurrence", () => ({ assignSourceOccurrences: vi.fn() }));

import { describeAccountProblems, findImportAccountProblems, runXeroImport, XeroImportError, XERO_ACCOUNT_MAPPINGS } from "./xero-import-service";
import { createSalesInvoice, listSalesInvoices } from "@/server/repositories/sales-invoice-repository";
import { createPurchaseBillWithLines, listPurchaseBillsBySupplier } from "@/server/repositories/purchase-bill-repository";
import { createChartOfAccount, listChartOfAccounts, updateChartOfAccount } from "@/server/repositories/chart-of-accounts-repository";
import { listCustomers } from "@/server/repositories/customer-repository";
import { createCustomer } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { parseXeroInvoiceLinesCsv } from "@/server/import-centre/xero-invoices-bills-parser";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const CO = "company-a";
const HEADER = "ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Total,TaxTotal,InvoiceAmountPaid,InvoiceAmountDue,Description,Quantity,UnitAmount,Discount,LineAmount,AccountCode,TaxType,TaxAmount,Currency,Type,Status";

/** Two lines of 2 x 50.00 + 15% VAT: net 200.00, VAT 30.00, total 230.00. */
function salesCsv(accountCode: string, number = "SI-01667102", type = "Sales invoice"): string {
  const row = (desc: string) => `Cafe A,${number},VOLORA abc,2026-08-25,2026-08-25,230.00,30.00,0.00,230.00,${desc},2,50.00,,100.00,${accountCode},Standard Rate Sales,15.00,ZAR,${type},Sent`;
  return [HEADER, row("Pepper Steak Pie 180g"), row("French Butter Croissant 120g")].join("\n");
}

function billCsv(accountCode: string): string {
  return [HEADER, `JVDL DISTRIBUTORS,INC43069,VOLORA x,2026-08-26,,115.00,15.00,0.00,115.00,MB Thick Bleach 25L,1,100.00,,100.00,${accountCode},Standard Rate Purchases,15.00,ZAR,Bill,archived (approved)`].join("\n");
}

/** The chart exactly as this import's own chart step would leave it. */
function chart(overrides: Partial<Record<string, Partial<ChartOfAccount>>> = {}): ChartOfAccount[] {
  return XERO_ACCOUNT_MAPPINGS.map((m, i) => ({
    id: i + 1, companyId: CO, accountCode: m.code, description: m.name, accountType: m.accountType, normalBalance: m.normalBalance, category: m.category, isActive: true,
    ...(overrides[m.code] ?? {}),
  }) as ChartOfAccount);
}

function run(input: { sales?: string; bills?: string }) {
  return runXeroImport(
    CO,
    {
      salesInvoicesCsv: input.sales ? { text: input.sales, filename: "sales-invoices.csv" } : undefined,
      billsCsv: input.bills ? { text: input.bills, filename: "bills.csv" } : undefined,
      contactsCsvBatches: [],
    },
    "tester@example.test",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  vi.mocked(listChartOfAccounts).mockResolvedValue(chart());
  vi.mocked(listSalesInvoices).mockResolvedValue([]);
  vi.mocked(listCustomers).mockResolvedValue([{ id: 7, name: "Cafe A", customerCode: "CAFE-A" }] as never);
  vi.mocked(listSuppliers).mockResolvedValue([{ id: 685, name: "JVDL DISTRIBUTORS" }] as never);
  vi.mocked(listPurchaseBillsBySupplier).mockResolvedValue([]);
  vi.mocked(createSalesInvoice).mockResolvedValue({ id: 901 } as never);
  vi.mocked(createPurchaseBillWithLines).mockResolvedValue({ bill: { id: 77 } } as never);
});

describe("Xero import — account mappings persist", () => {
  it("stores account 1000 on every imported line and keeps Xero's own totals and VAT", async () => {
    const outcome = await run({ sales: salesCsv("1000") });

    expect(outcome.salesInvoices).toMatchObject({ found: 1, imported: 1, duplicatesPrevented: 0, errors: [] });
    expect(createSalesInvoice).toHaveBeenCalledTimes(1);
    const [, input, totals] = vi.mocked(createSalesInvoice).mock.calls[0];
    expect(input.lines.map((l) => l.glAccount)).toEqual(["1000", "1000"]);
    expect(input.lines.map((l) => l.vatCode)).toEqual(["Standard Rated", "Standard Rated"]);
    expect(input.customerId).toBe(7);
    expect(totals).toMatchObject({ subtotal: 200, vatAmount: 30, total: 230 });
    expect(totals.lines.map((l) => [l.netAmount, l.vatAmount, l.lineTotal])).toEqual([[100, 15, 115], [100, 15, 115]]);
    // The header is then pinned to Xero's exact figures; outstanding = amount due.
    expect(updates).toContainEqual({ subtotal: 200, vat_amount: 30, total: 230, outstanding: 230 });
  });

  it("keeps a credit note a Credit Note with its account", async () => {
    await run({ sales: salesCsv("1000", "CN-3607", "Sales credit note") });
    const [, input] = vi.mocked(createSalesInvoice).mock.calls[0];
    expect(input.documentType).toBe("Credit Note");
    expect(input.lines.every((l) => l.glAccount === "1000")).toBe(true);
  });
});

describe("Xero import — missing or invalid accounts are refused before anything is written", () => {
  async function expectRefused(sales: string, message: RegExp) {
    await expect(run({ sales })).rejects.toThrow(XeroImportError);
    await expect(run({ sales })).rejects.toThrow(message);
    expect(createSalesInvoice).not.toHaveBeenCalled();
    expect(createChartOfAccount).not.toHaveBeenCalled();
    expect(updateChartOfAccount).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  }

  it("refuses a blank AccountCode (the older Batch 1B file)", async () => {
    await expectRefused(salesCsv(""), /Nothing was imported: 2 line\(s\) on 1 document\(s\).*SI-01667102 line 1: no AccountCode/);
  });

  it("refuses an account that is not in the chart (e.g. a raw Xero code 220)", async () => {
    await expectRefused(salesCsv("220"), /SI-01667102 line 1 \(220\): account is not in the chart of accounts/);
  });

  it("refuses an inactive account", async () => {
    vi.mocked(listChartOfAccounts).mockResolvedValue(chart({ "1000": { isActive: false } }));
    await expectRefused(salesCsv("1000"), /\(1000\): account is inactive/);
  });

  it("refuses a sales line on a non-Income account", async () => {
    await expectRefused(salesCsv("1500"), /\(1500\): account is Cost of Sales, not Income/);
  });
});

describe("Xero import — re-importing never duplicates", () => {
  it("skips an invoice whose number already exists, creating nothing", async () => {
    vi.mocked(listSalesInvoices).mockResolvedValue([{ invoiceNumber: "SI-01667102" }] as never);
    const outcome = await run({ sales: salesCsv("1000") });
    expect(outcome.salesInvoices).toMatchObject({ found: 1, imported: 0, duplicatesPrevented: 1 });
    expect(createSalesInvoice).not.toHaveBeenCalled();
  });

  it("re-uploading the blank-account file for invoices already imported is harmless: nothing is refused or created", async () => {
    vi.mocked(listSalesInvoices).mockResolvedValue([{ invoiceNumber: "SI-01667102" }] as never);
    const outcome = await run({ sales: salesCsv("") });
    expect(outcome.salesInvoices).toMatchObject({ imported: 0, duplicatesPrevented: 1 });
    expect(createSalesInvoice).not.toHaveBeenCalled();
  });
});

describe("Xero import — bills", () => {
  it("still accepts a bill line without an account, but says so", async () => {
    const outcome = await run({ bills: billCsv("") });
    expect(outcome.bills.imported).toBe(1);
    expect(outcome.bills.warnings).toContainEqual({ identifier: "INC43069", reason: "1 line(s) have no expense account — assign one before the bill is approved." });
  });

  it("refuses a bill line whose account does not exist", async () => {
    await expect(run({ bills: billCsv("9999") })).rejects.toThrow(/INC43069 line 1 \(9999\): account is not in the chart of accounts/);
    expect(createPurchaseBillWithLines).not.toHaveBeenCalled();
  });
});

describe("findImportAccountProblems / describeAccountProblems", () => {
  const invoices = parseXeroInvoiceLinesCsv(salesCsv(""), "x.csv").invoices;

  it("counts an account the chart step will create as valid", () => {
    const problems = findImportAccountProblems({
      salesInvoices: parseXeroInvoiceLinesCsv(salesCsv("1005"), "x.csv").invoices,
      bills: [],
      existingSalesInvoiceNumbers: new Set(),
      chart: [],
      plannedAccounts: XERO_ACCOUNT_MAPPINGS,
    });
    expect(problems).toEqual([]);
  });

  it("lists at most ten problems and counts the rest", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ document: `SI-${i}`, line: 1, accountCode: "", reason: "no AccountCode" }));
    const text = describeAccountProblems(many);
    expect(text).toMatch(/^Nothing was imported: 12 line\(s\) on 12 document\(s\)/);
    expect(text).toMatch(/and 2 more\. Correct the AccountCode column and upload again\.$/);
    expect(findImportAccountProblems({ salesInvoices: invoices, bills: [], existingSalesInvoiceNumbers: new Set(), chart: chart(), plannedAccounts: [] })).toHaveLength(2);
  });
});
