/**
 * Regression: a Xero credit note is stored with PRECISIA's sign convention
 * (positive figures; the document type gives the direction).
 *
 * Xero exports credit notes with negative amounts. The importer stored
 * them verbatim, and every consumer — the 'Customer Credit Note' posting
 * rule, the VAT201 engine, statements, the approval limit — negated them a
 * second time: the ten credit notes imported for Metanoia Hospitality
 * increased Debtors and Output VAT when posted. Every dependency is
 * mocked; this never touches a real Supabase project.
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

import { normaliseCreditNoteSign, runXeroImport, XERO_ACCOUNT_MAPPINGS } from "./xero-import-service";
import { createSalesInvoice, listSalesInvoices } from "@/server/repositories/sales-invoice-repository";
import { createPurchaseBillWithLines, listPurchaseBillsBySupplier } from "@/server/repositories/purchase-bill-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listCustomers } from "@/server/repositories/customer-repository";
import { listSuppliers } from "@/server/repositories/supplier-reconciliation-repository";
import { parseXeroInvoiceLinesCsv } from "@/server/import-centre/xero-invoices-bills-parser";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const CO = "company-a";
const HEADER = "ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Total,TaxTotal,InvoiceAmountPaid,InvoiceAmountDue,Description,Quantity,UnitAmount,Discount,LineAmount,AccountCode,TaxType,TaxAmount,Currency,Type,Status";

/** CN-3607 exactly as Xero exports it (three negative lines), except that
 * the amount due is the full credit, to show its sign too. */
const CN_3607 = [
  HEADER,
  "What's The Scoop,CN-3607,ANDREA,6/08/2026,,-343.39,-44.79,0.00,-343.39,Boerewors/Relish 160gr (2 X 4 PACK),8,-19.95,,-159.60,1000,Standard Rate Sales,-23.94,ZAR,Sales credit note,Paid",
  "What's The Scoop,CN-3607,ANDREA,6/08/2026,,-343.39,-44.79,0.00,-343.39,Apple puffs (2 X 4 PACK),8,-6.95,,-55.60,1000,Standard Rate Sales,-8.34,ZAR,Sales credit note,Paid",
  "What's The Scoop,CN-3607,ANDREA,6/08/2026,,-343.39,-44.79,0.00,-343.39,Custard Puffs (3 X 4 PACK),12,-6.95,,-83.40,1000,Standard Rate Sales,-12.51,ZAR,Sales credit note,Paid",
].join("\n");

const INVOICE = [HEADER, "What's The Scoop,INV-3576,ANDREA,30/07/2026,31/07/2026,115.00,15.00,0.00,115.00,Pie,1,100.00,,100.00,1000,Standard Rate Sales,15.00,ZAR,Sales invoice,Awaiting Payment"].join("\n");

const BILL_CREDIT_NOTE = [HEADER, "JVDL DISTRIBUTORS,CR-77,,26/08/2026,,-115.00,-15.00,0.00,-115.00,Returned bleach,1,-100.00,,-100.00,1000,Standard Rate Purchases,-15.00,ZAR,Bill credit note,Paid"].join("\n");

function chart(): ChartOfAccount[] {
  return XERO_ACCOUNT_MAPPINGS.map((m, i) => ({ id: i + 1, companyId: CO, accountCode: m.code, description: m.name, accountType: m.accountType, normalBalance: m.normalBalance, category: m.category, isActive: true }) as ChartOfAccount);
}

const group = (csv: string) => parseXeroInvoiceLinesCsv(csv, "sales-invoices.csv").invoices[0];

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  vi.mocked(listChartOfAccounts).mockResolvedValue(chart());
  vi.mocked(listSalesInvoices).mockResolvedValue([]);
  vi.mocked(listCustomers).mockResolvedValue([{ id: 70, name: "What's The Scoop", customerCode: "WTS" }] as never);
  vi.mocked(listSuppliers).mockResolvedValue([{ id: 685, name: "JVDL DISTRIBUTORS" }] as never);
  vi.mocked(listPurchaseBillsBySupplier).mockResolvedValue([]);
  vi.mocked(createSalesInvoice).mockResolvedValue({ id: 901 } as never);
  vi.mocked(createPurchaseBillWithLines).mockResolvedValue({ bill: { id: 77 } } as never);
});

describe("normaliseCreditNoteSign", () => {
  it("flips a negative Xero credit note to positive figures, keeping quantities, descriptions, accounts and tax types", () => {
    const source = group(CN_3607);
    const cn = normaliseCreditNoteSign(source);
    expect(cn).toMatchObject({ total: 343.39, taxTotal: 44.79, amountPaid: 0, amountDue: 343.39 });
    expect(cn.lines.map((l) => [l.quantity, l.unitAmount, l.lineAmount, l.taxAmount])).toEqual([[8, 19.95, 159.6, 23.94], [8, 6.95, 55.6, 8.34], [12, 6.95, 83.4, 12.51]]);
    expect(cn.lines.map((l) => [l.description, l.accountCode, l.taxType])).toEqual(source.lines.map((l) => [l.description, l.accountCode, l.taxType]));
  });

  it("leaves an invoice exactly as it is", () => {
    const inv = group(INVOICE);
    expect(normaliseCreditNoteSign(inv)).toBe(inv);
  });

  it("leaves a credit note that is already positive exactly as it is", () => {
    const positive = group(CN_3607.replace(/,-/g, ","));
    expect(positive.total).toBe(343.39);
    expect(normaliseCreditNoteSign(positive)).toBe(positive);
  });
});

describe("Xero import — credit notes are stored as positive figures", () => {
  it("a sales credit note: positive lines, header, VAT and outstanding (CN-3607)", async () => {
    const outcome = await runXeroImport(CO, { salesInvoicesCsv: { text: CN_3607, filename: "sales-invoices.csv" }, contactsCsvBatches: [] }, "tester@example.test");
    expect(outcome.salesInvoices).toMatchObject({ found: 1, imported: 1, errors: [] });
    const [, input, totals] = vi.mocked(createSalesInvoice).mock.calls[0];
    expect(input.documentType).toBe("Credit Note");
    expect(input.lines.map((l) => [l.quantity, l.unitPrice, l.discount])).toEqual([[8, 19.95, 0], [8, 6.95, 0], [12, 6.95, 0]]);
    expect(totals).toMatchObject({ subtotal: 298.6, vatAmount: 44.79, total: 343.39 });
    expect(totals.lines.map((l) => [l.netAmount, l.vatAmount, l.lineTotal])).toEqual([[159.6, 23.94, 183.54], [55.6, 8.34, 63.94], [83.4, 12.51, 95.91]]);
    // Header pinned to Xero's figures, now positive. (`subtotal` is written
    // as total − VAT unrounded, as before this change; the numeric(14,2)
    // column stores it to the cent.)
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ vat_amount: 44.79, total: 343.39, outstanding: 343.39 });
    expect(Math.round(Number(updates[0].subtotal) * 100) / 100).toBe(298.6);
  });

  it("an invoice is imported exactly as before", async () => {
    await runXeroImport(CO, { salesInvoicesCsv: { text: INVOICE, filename: "sales-invoices.csv" }, contactsCsvBatches: [] }, "tester@example.test");
    expect(updates).toContainEqual({ subtotal: 100, vat_amount: 15, total: 115, outstanding: 115 });
  });

  it("a supplier credit note: positive lines, VAT, total and outstanding", async () => {
    const outcome = await runXeroImport(CO, { billsCsv: { text: BILL_CREDIT_NOTE, filename: "bills.csv" }, contactsCsvBatches: [] }, "tester@example.test");
    expect(outcome.bills).toMatchObject({ found: 1, imported: 1, errors: [] });
    const [, header, taxTotal, total, lines] = vi.mocked(createPurchaseBillWithLines).mock.calls[0];
    expect(header.documentType).toBe("Credit Note");
    expect([taxTotal, total]).toEqual([15, 115]);
    expect(lines.map((l) => [l.unitCost, l.netAmount, l.vatAmount, l.lineTotal])).toEqual([[100, 100, 15, 115]]);
    expect(updates).toContainEqual({ outstanding: 115 });
  });
});
