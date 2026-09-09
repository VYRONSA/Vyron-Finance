/**
 * Phase 24B — the main orchestrator. Every dependency is mocked; this
 * never touches a real Supabase project, real Chromium, or a real email
 * provider. Covers: recipient resolution (primary contact, fallback, no
 * email at all), the PDF being generated exactly once, the SAME buffer
 * reaching `uploadDocument`, correct `queueCommunication` wiring, and
 * tenant isolation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/services/sales-invoice-service", () => ({ getSalesInvoice: vi.fn() }));
vi.mock("@/server/services/customer-service", () => ({ getCustomer: vi.fn() }));
vi.mock("@/server/services/customer-matching-service", () => ({ getCustomerStatement: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));
vi.mock("@/server/services/company-branding-service", () => ({ getCompanyLogoDataUri: vi.fn() }));
vi.mock("@/server/pdf/pdf-generation-service", () => ({ generateInvoicePdf: vi.fn(), generateStatementPdf: vi.fn() }));
vi.mock("@/server/services/document-service", () => ({ uploadDocument: vi.fn() }));
vi.mock("@/server/services/communication-service", () => ({ queueCommunication: vi.fn() }));
vi.mock("@/server/repositories/customer-repository", () => ({ listCustomerContacts: vi.fn() }));

import { sendInvoiceEmail, sendStatementEmail, ValidationError, NotFoundError } from "./document-email-service";
import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { getCustomer } from "@/server/services/customer-service";
import { getCustomerStatement } from "@/server/services/customer-matching-service";
import { getCompany } from "@/server/services/company-service";
import { getCompanyLogoDataUri } from "@/server/services/company-branding-service";
import { generateInvoicePdf, generateStatementPdf } from "@/server/pdf/pdf-generation-service";
import { uploadDocument } from "@/server/services/document-service";
import { queueCommunication } from "@/server/services/communication-service";
import { listCustomerContacts } from "@/server/repositories/customer-repository";
import type { SalesInvoice } from "@/server/sales/types";
import type { Customer, CustomerContact } from "@/server/customer-management/types";
import type { Company } from "@/server/company-management/types";

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 501, companyId: "company-a", documentType: "Invoice", invoiceNumber: "INV000125", customerId: 42, invoiceDate: "2026-08-01",
    dueDate: null, reference: "", status: "Posted", subtotal: 100, vatAmount: 15, total: 115, outstanding: 0, notes: "",
    lines: [], journalId: null, createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as SalesInvoice;
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 42, companyId: "company-a", customerCode: "CUST-001", name: "Northwood Management", customerType: "Company",
    customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit: 0, paymentTermsDays: 30,
    currencyCode: "ZAR", priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function contact(overrides: Partial<CustomerContact> = {}): CustomerContact {
  return { id: 1, customerId: 42, name: "Jane", email: "jane@northwood.co.za", phone: "", mobile: "", position: "", isPrimary: true, createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-a", organisationId: "org_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
    tradingName: "Fenwick & Rowe", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

const FAKE_PDF = Buffer.from("%PDF-fake-invoice");

beforeEach(() => {
  vi.mocked(getSalesInvoice).mockReset().mockResolvedValue(invoice());
  vi.mocked(getCustomer).mockReset().mockResolvedValue(customer());
  vi.mocked(getCustomerStatement).mockReset().mockResolvedValue([{ date: "2026-07-01", type: "Invoice", reference: "INV1", documentId: 1, debit: 500, credit: 0, balance: 500 } as never]);
  vi.mocked(getCompany).mockReset().mockResolvedValue(company());
  vi.mocked(getCompanyLogoDataUri).mockReset().mockResolvedValue(null);
  vi.mocked(generateInvoicePdf).mockReset().mockResolvedValue(FAKE_PDF);
  vi.mocked(generateStatementPdf).mockReset().mockResolvedValue(FAKE_PDF);
  vi.mocked(uploadDocument).mockReset().mockResolvedValue({ id: 999 } as never);
  vi.mocked(queueCommunication).mockReset().mockResolvedValue({ id: 1, status: "Queued" } as never);
  vi.mocked(listCustomerContacts).mockReset().mockResolvedValue([contact()]);
});

function fakeRequest(): Request {
  return new Request("http://localhost/api/companies/company-a/sales/invoices/501/send-email", { method: "POST" });
}

describe("sendInvoiceEmail — recipient resolution", () => {
  it("uses the primary contact's email when present", async () => {
    vi.mocked(listCustomerContacts).mockResolvedValue([contact({ isPrimary: false, email: "other@x.com" }), contact({ isPrimary: true, email: "primary@x.com" })]);
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const call = vi.mocked(queueCommunication).mock.calls[0]![1];
    expect(call.recipients[0]!.address).toBe("primary@x.com");
  });

  it("falls back to any contact with a real email when there's no primary", async () => {
    vi.mocked(listCustomerContacts).mockResolvedValue([contact({ isPrimary: false, email: "only@x.com" })]);
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const call = vi.mocked(queueCommunication).mock.calls[0]![1];
    expect(call.recipients[0]!.address).toBe("only@x.com");
  });

  it("throws an honest ValidationError, never fabricating an address, when the customer has no email on file", async () => {
    vi.mocked(listCustomerContacts).mockResolvedValue([contact({ email: "" })]);
    await expect(sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant")).rejects.toBeInstanceOf(ValidationError);
    expect(queueCommunication).not.toHaveBeenCalled();
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("throws an honest ValidationError when the customer has no contacts at all", async () => {
    vi.mocked(listCustomerContacts).mockResolvedValue([]);
    await expect(sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("sendInvoiceEmail — not found", () => {
  it("throws NotFoundError for an invoice that doesn't resolve in this company", async () => {
    vi.mocked(getSalesInvoice).mockResolvedValue(null);
    await expect(sendInvoiceEmail(fakeRequest(), "company-a", 999, "Jane Accountant")).rejects.toBeInstanceOf(NotFoundError);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the invoice's own customer can't be resolved", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    await expect(sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("sendInvoiceEmail — PDF generated exactly once, same bytes attached", () => {
  it("calls generateInvoicePdf exactly once", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
  });

  it("passes the SAME PDF buffer bytes into uploadDocument — never a second generation", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const uploadCall = vi.mocked(uploadDocument).mock.calls[0]![0];
    const uploadedBytes = new Uint8Array(await uploadCall.file.arrayBuffer());
    expect(Buffer.from(uploadedBytes).equals(FAKE_PDF)).toBe(true);
  });

  it("uploads the document as entityType SalesInvoice / category Invoice, with the real invoice number as filename", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const uploadCall = vi.mocked(uploadDocument).mock.calls[0]![0];
    expect(uploadCall.entityType).toBe("SalesInvoice");
    expect(uploadCall.entityId).toBe(501);
    expect(uploadCall.category).toBe("Invoice");
    expect(uploadCall.filename).toBe("INV000125.pdf");
  });

  it("passes the uploaded document's real id as the communication's documentIds", async () => {
    vi.mocked(uploadDocument).mockResolvedValue({ id: 777 } as never);
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const call = vi.mocked(queueCommunication).mock.calls[0]![1];
    expect(call.documentIds).toEqual([777]);
  });
});

describe("sendInvoiceEmail — queueCommunication wiring", () => {
  it("uses the Email channel and the Sales module", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const call = vi.mocked(queueCommunication).mock.calls[0]![1];
    expect(call.channel).toBe("Email");
    expect(call.module).toBe("Sales");
    expect(call.businessObjectType).toBe("SalesInvoice");
    expect(call.businessObjectId).toBe(501);
  });

  it("returns the real CommunicationRecord from queueCommunication", async () => {
    vi.mocked(queueCommunication).mockResolvedValue({ id: 55, status: "Queued" } as never);
    const result = await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    expect(result).toEqual({ id: 55, status: "Queued" });
  });
});

describe("sendInvoiceEmail — outbound email idempotency (Phase 25J)", () => {
  it("passes no idempotency-key-like field of its own — the communication service owns that identity, computed later from the persisted row's own id", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const call = vi.mocked(queueCommunication).mock.calls[0]![1];
    expect(call).not.toHaveProperty("idempotencyKey");
    expect(call).not.toHaveProperty("messageId");
  });

  it("a deliberate second 'Send Email' click creates a genuinely NEW communication (new id -> new identity), never deduplicated against the first send", async () => {
    vi.mocked(queueCommunication).mockResolvedValueOnce({ id: 100, status: "Queued" } as never);
    vi.mocked(queueCommunication).mockResolvedValueOnce({ id: 101, status: "Queued" } as never);

    const first = await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    const second = await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");

    // Two real, separate calls into queueCommunication — a resend is
    // architecturally just "call the entry point again," which the
    // Communication Platform already treats as a brand-new row/id, and
    // therefore (per communication-service.ts) a brand-new idempotency
    // identity. No dedup logic here would silently swallow the second click.
    expect(queueCommunication).toHaveBeenCalledTimes(2);
    expect(first.id).not.toBe(second.id);
  });

  it("re-generates the PDF fresh on a genuine resend (this is NOT a retry — a new document is the existing, unchanged architecture's intent)", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");
    await sendInvoiceEmail(fakeRequest(), "company-a", 501, "Jane Accountant");

    expect(generateInvoicePdf).toHaveBeenCalledTimes(2);
    expect(uploadDocument).toHaveBeenCalledTimes(2);
  });
});

describe("sendInvoiceEmail — tenant isolation", () => {
  it("passes the exact companyId through to every downstream call", async () => {
    await sendInvoiceEmail(fakeRequest(), "company-b", 501, "Jane Accountant");
    expect(getSalesInvoice).toHaveBeenCalledWith("company-b", 501);
    expect(getCustomer).toHaveBeenCalledWith("company-b", 42);
    expect(getCompany).toHaveBeenCalledWith("company-b");
    expect(generateInvoicePdf).toHaveBeenCalledWith(expect.anything(), "company-b", 501);
    const uploadCall = vi.mocked(uploadDocument).mock.calls[0]![0];
    expect(uploadCall.companyId).toBe("company-b");
    expect(queueCommunication).toHaveBeenCalledWith("company-b", expect.anything());
  });
});

describe("sendStatementEmail", () => {
  it("resolves the recipient, generates the PDF once, uploads as Customer/Statement, and queues the email", async () => {
    const result = await sendStatementEmail(fakeRequest(), "company-a", 42, "Jane Accountant");
    expect(generateStatementPdf).toHaveBeenCalledTimes(1);
    const uploadCall = vi.mocked(uploadDocument).mock.calls[0]![0];
    expect(uploadCall.entityType).toBe("Customer");
    expect(uploadCall.entityId).toBe(42);
    expect(uploadCall.category).toBe("Statement");
    expect(result).toEqual({ id: 1, status: "Queued" });
  });

  it("throws ValidationError, never fabricating an address, when the customer has no email", async () => {
    vi.mocked(listCustomerContacts).mockResolvedValue([]);
    await expect(sendStatementEmail(fakeRequest(), "company-a", 42, "Jane Accountant")).rejects.toBeInstanceOf(ValidationError);
    expect(generateStatementPdf).not.toHaveBeenCalled();
  });

  it("throws NotFoundError for a customer that doesn't resolve in this company", async () => {
    vi.mocked(getCustomer).mockResolvedValue(null);
    await expect(sendStatementEmail(fakeRequest(), "company-a", 999, "Jane Accountant")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("uses the real closing balance from getCustomerStatement, never a fabricated one", async () => {
    vi.mocked(getCustomerStatement).mockResolvedValue([{ date: "2026-07-01", type: "Invoice", reference: "INV1", documentId: 1, debit: 0, credit: 0, balance: 3210.55 } as never]);
    await sendStatementEmail(fakeRequest(), "company-a", 42, "Jane Accountant");
    const call = vi.mocked(queueCommunication).mock.calls[0]![1];
    expect(call.body).toContain((3210.55).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  });
});
