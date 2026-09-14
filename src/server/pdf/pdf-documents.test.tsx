// @vitest-environment node
/**
 * What goes INTO a server-generated PDF: the document is built from the
 * same services the app's routes use, scoped to the requesting company (so
 * the user's own session and RLS decide what can be read), rendered to one
 * self-contained HTML page that references nothing on the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/is-configured", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/server/services/sales-invoice-service", () => ({ getSalesInvoice: vi.fn() }));
vi.mock("@/server/services/customer-service", () => ({ getCustomer: vi.fn(), listCustomerAddresses: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));
vi.mock("@/server/services/company-branding-service", () => ({ getCompanyLogoDataUri: vi.fn() }));
vi.mock("@/server/services/customer-matching-service", () => ({ getCustomerStatement: vi.fn() }));
vi.mock("@/server/report-centre/letterhead", () => ({ loadLetterhead: vi.fn() }));

import { businessDocumentPdfHtml, invoicePdfHtml, reportPdfHtml, statementPdfHtml } from "./pdf-documents";
import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { getCustomer, listCustomerAddresses } from "@/server/services/customer-service";
import { getCompany } from "@/server/services/company-service";
import { getCompanyLogoDataUri } from "@/server/services/company-branding-service";
import { getCustomerStatement } from "@/server/services/customer-matching-service";
import { loadLetterhead } from "@/server/report-centre/letterhead";
import { createPreviewSource } from "@/server/report-centre/preview-source";
import { runReport } from "@/server/report-centre/run";
import { loadBusinessDocument } from "@/server/report-centre/documents";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SIGNED_LOGO_URL = "https://project.supabase.co/storage/v1/object/sign/branding/logo.png?token=secret";

const company = { name: "Metanoia Hospitality (Pty) Ltd", tradingName: "", address: "12 Long Street, Cape Town", postalAddress: "", telephone: "021 000 0000", email: "accounts@metanoia.example", website: "", registrationNumber: "2020/000001/07", vatNumber: "4000000001" };
const invoice = {
  id: 17, companyId: "company-a", customerId: 5, documentType: "Invoice", invoiceNumber: "INV-0017", invoiceDate: "2026-07-31", dueDate: "2026-08-31",
  reference: "PO-88", status: "Draft", subtotal: 20000, vatAmount: 3000, total: 23000, outstanding: 23000, notes: "Thank you for your business.",
  lines: [{ id: 1, description: "Catering — July", quantity: 1, unitPrice: 20000, vatAmount: 3000, lineTotal: 23000 }],
};
const customer = { id: 5, name: "Kingdom Foods", vatNumber: "4123456789", registrationNumber: "2019/123456/07" };
const addresses = [
  { id: 1, customerId: 5, addressType: "Delivery", line1: "9 Dock Road", line2: "", city: "Cape Town", region: "", postalCode: "", country: "", isDefault: false, createdAt: "" },
  { id: 2, customerId: 5, addressType: "Billing", line1: "1 Main Road", line2: "", city: "Cape Town", region: "", postalCode: "8001", country: "", isDefault: true, createdAt: "" },
];

function expectSelfContained(html: string) {
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).not.toMatch(/(?:src|href)="https?:/i);
  expect(html).not.toMatch(/url\(\s*["']?https?:/i);
  expect(html).not.toMatch(/<script/i);
}

beforeEach(() => {
  vi.mocked(getSalesInvoice).mockReset().mockResolvedValue(invoice as never);
  vi.mocked(getCustomer).mockReset().mockResolvedValue(customer as never);
  vi.mocked(listCustomerAddresses).mockReset().mockResolvedValue(addresses as never);
  vi.mocked(getCompany).mockReset().mockResolvedValue(company as never);
  vi.mocked(getCompanyLogoDataUri).mockReset().mockResolvedValue(LOGO);
  vi.mocked(getCustomerStatement).mockReset().mockResolvedValue([
    { date: "2026-07-31", type: "Invoice", reference: "INV-0017", documentId: 17, debit: 23000, credit: 0, balance: 23000 },
    { date: "2026-08-15", type: "Receipt", reference: "RCT-0004", documentId: 4, debit: 0, credit: 1234.5, balance: 21765.5 },
  ]);
  vi.mocked(loadLetterhead).mockReset().mockResolvedValue({ ...company, logoUrl: SIGNED_LOGO_URL });
});

describe("invoice", () => {
  it("contains the real invoice, customer, address, company and logo", async () => {
    const html = (await invoicePdfHtml("company-a", 17))!;
    for (const text of ["Tax Invoice", "INV-0017", "Kingdom Foods", "1 Main Road, Cape Town, 8001", "VAT No: 4123456789", "Metanoia Hospitality (Pty) Ltd", "Catering — July", "20,000.00", "3,000.00", "23,000.00", LOGO]) {
      expect(html).toContain(text);
    }
    expectSelfContained(html);
  });

  it("reads everything for the requesting company only", async () => {
    await invoicePdfHtml("company-a", 17);
    expect(getSalesInvoice).toHaveBeenCalledWith("company-a", 17);
    expect(getCustomer).toHaveBeenCalledWith("company-a", 5);
    expect(listCustomerAddresses).toHaveBeenCalledWith("company-a", 5);
    expect(getCompany).toHaveBeenCalledWith("company-a");
    expect(getCompanyLogoDataUri).toHaveBeenCalledWith("company-a");
  });

  it("an invoice the user cannot see (RLS returns nothing) yields no document", async () => {
    vi.mocked(getSalesInvoice).mockResolvedValue(null);
    expect(await invoicePdfHtml("company-a", 17)).toBeNull();
  });

  it("still renders when the customer has no address or the logo cannot be read", async () => {
    vi.mocked(listCustomerAddresses).mockRejectedValue(new Error("denied"));
    vi.mocked(getCompanyLogoDataUri).mockRejectedValue(new Error("storage down"));
    const html = (await invoicePdfHtml("company-a", 17))!;
    expect(html).toContain("INV-0017");
    expect(html).not.toContain("<img");
  });
});

describe("customer statement", () => {
  it("contains the statement entries and balances", async () => {
    const html = (await statementPdfHtml("company-a", 5))!;
    for (const text of ["Statement of Account", "Kingdom Foods", "RCT-0004", "1,234.50", "21,765.50", LOGO]) expect(html).toContain(text);
    expect(getCustomerStatement).toHaveBeenCalledWith("company-a", 5);
    expectSelfContained(html);
  });

  it("an unknown customer yields no document", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    expect(await statementPdfHtml("company-a", 5)).toBeNull();
  });
});

describe("Reporting Centre report", () => {
  it("renders the report and swaps the signed Storage logo URL for the inline logo", async () => {
    const { result } = await runReport(createPreviewSource("demo"), "trial-balance", {});
    const html = await reportPdfHtml("company-a", result);
    expect(html).toContain(result.title);
    expect(html).toContain(LOGO);
    expect(html).not.toContain(SIGNED_LOGO_URL);
    expectSelfContained(html);
  });
});

describe("Document Centre document", () => {
  it("renders the document with the inline logo", async () => {
    const source = createPreviewSource("demo");
    const document = (await loadBusinessDocument(source, "purchase-bill", 101)) ?? (await loadBusinessDocument(source, "sales-invoice", 2));
    expect(document).not.toBeNull();
    const html = await businessDocumentPdfHtml("company-a", document!);
    expect(html).toContain(document!.number);
    expect(html).toContain(LOGO);
    expectSelfContained(html);
  });
});
