import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { InvoiceDocument } from "./invoice-document";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { Customer } from "@/server/customer-management/types";

const EMPTY_BRANDING = { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null };
const WITH_LOGO = { hasLogo: true, logoUrl: "https://storage.example/signed-logo-url", logoFilename: "logo.png", logoMimeType: "image/png", logoSizeBytes: 2048, updatedAt: "2026-08-01T00:00:00.000Z" };

function company(companyId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: companyId, organisationId: "org_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
    tradingName: "", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "",
    ...overrides,
  };
}

function money(value: number): string {
  // testing-library's default text matcher collapses all whitespace
  // (including the narrow no-break space some locales use as a
  // thousands separator) down to a single regular space before
  // comparing — normalize the same way here so the two never disagree.
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, " ");
}

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    id: 1, invoiceId: 1, lineOrder: 1, description: "Consulting services", quantity: 2, unitPrice: 500,
    lineTotal: 1000, stockItemId: null, glAccount: null, vatCode: "Standard Rated", discount: 0, netAmount: 1000, vatAmount: 150,
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "company-a", customerId: 10, orderId: null, deliveryId: null, invoiceNumber: "INV-0001",
    documentType: "Invoice", invoiceDate: "2026-08-01", dueDate: "2026-08-31", vatTreatmentCode: "Standard Rated",
    status: "Posted", journalId: 5, subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 1150,
    isRecurringTemplate: false, recurrencePattern: "", reference: "PO-77", notes: "",
    createdAt: "2026-08-01T00:00:00Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
    postedAt: "2026-08-01T00:00:00Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: null,
    lines: [line()],
    ...overrides,
  };
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 10, companyId: "company-a", customerCode: "CUST-010", name: "Acme Retail", customerType: "Company",
    customerGroup: "", industry: "Retail", vatNumber: "4123456789", registrationNumber: "2020/000111/07",
    creditLimit: 50000, paymentTermsDays: 30, currencyCode: "ZAR", priceList: "", salesRep: "", isActive: true,
    riskRating: "Low", notes: "", createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function stubFetch(companyId: string, brandingBody: unknown = EMPTY_BRANDING, companyOverrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url === `/api/companies/${companyId}`) return Promise.resolve({ ok: true, json: async () => ({ company: company(companyId, companyOverrides) }) });
    if (url === `/api/companies/${companyId}/branding`) return Promise.resolve({ ok: true, json: async () => ({ branding: brandingBody }) });
    if (url.includes("/addresses")) return Promise.resolve({ ok: true, json: async () => ({ addresses: [] }) });
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("InvoiceDocument — rendering", () => {
  it("renders nothing when closed", () => {
    stubFetch("company-a");
    const { container } = render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders with the company logo", async () => {
    stubFetch("company-a", WITH_LOGO);
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open onClose={vi.fn()} />);
    const img = await screen.findByRole("img", { name: /logo/i });
    expect(img).toHaveAttribute("src", WITH_LOGO.logoUrl);
  });

  it("renders correctly without a logo", async () => {
    stubFetch("company-a", EMPTY_BRANDING);
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("uses the correct company's branding (fetches the given companyId, not another)", async () => {
    const fetchMock = stubFetch("company-a", WITH_LOGO);
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open onClose={vi.fn()} />);
    await screen.findByRole("img", { name: /logo/i });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/companies/company-a/branding");
    expect(urls.some((u) => u.includes("company-b"))).toBe(false);
  });

  it("displays invoice totals exactly as provided — never recomputed", async () => {
    stubFetch("company-a");
    const inv = invoice({ subtotal: 2500.5, vatAmount: 375.08, total: 2875.58, outstanding: 900 });
    render(<InvoiceDocument companyId="company-a" invoice={inv} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(money(2500.5))).toBeInTheDocument();
      expect(screen.getByText(money(375.08))).toBeInTheDocument();
      expect(screen.getByText(money(2875.58))).toBeInTheDocument();
      expect(screen.getByText(money(900))).toBeInTheDocument();
    });
  });

  it("displays every existing invoice line unchanged", async () => {
    stubFetch("company-a");
    const inv = invoice({ lines: [line({ id: 1, description: "Design work", quantity: 3, unitPrice: 200, lineTotal: 600 }), line({ id: 2, description: "Hosting", quantity: 1, unitPrice: 89.5, lineTotal: 89.5 })] });
    render(<InvoiceDocument companyId="company-a" invoice={inv} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Design work")).toBeInTheDocument();
      expect(screen.getByText("Hosting")).toBeInTheDocument();
      expect(screen.getAllByText(money(89.5)).length).toBeGreaterThan(0);
    });
  });

  it("shows the customer's name, VAT number, and registration number", async () => {
    stubFetch("company-a");
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer({ name: "Acme Retail", vatNumber: "4123456789" })} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Acme Retail")).toBeInTheDocument();
      expect(screen.getByText(/4123456789/)).toBeInTheDocument();
    });
  });

  it("falls back to a placeholder label rather than fabricating a name when no customer record is available", async () => {
    stubFetch("company-a");
    render(<InvoiceDocument companyId="company-a" invoice={invoice({ customerId: 999 })} customer={undefined} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Customer #999")).toBeInTheDocument());
  });

  it("fetches the customer address scoped to this invoice's own customerId and company", async () => {
    const fetchMock = stubFetch("company-a");
    render(<InvoiceDocument companyId="company-a" invoice={invoice({ customerId: 10 })} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/companies/company-a/customers/10/addresses")).toBe(true));
  });
});

describe("InvoiceDocument — Phase 20D expanded company profile", () => {
  it("displays the company's Trading Name when present", async () => {
    stubFetch("company-a", EMPTY_BRANDING, { tradingName: "Fenwick & Rowe" });
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("t/a Fenwick & Rowe")).toBeInTheDocument());
  });

  it("displays the company's VAT Number when present", async () => {
    stubFetch("company-a", EMPTY_BRANDING, { vatNumber: "4123456789" });
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/VAT No: 4123456789/)).toBeInTheDocument());
  });

  it("displays the company's contact information when present", async () => {
    stubFetch("company-a", EMPTY_BRANDING, { telephone: "021 555 0123", email: "accounts@fenwickrowe.co.za", website: "www.fenwickrowe.co.za" });
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer()} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/021 555 0123/)).toBeInTheDocument();
      expect(screen.getByText(/accounts@fenwickrowe\.co\.za/)).toBeInTheDocument();
      expect(screen.getByText(/www\.fenwickrowe\.co\.za/)).toBeInTheDocument();
    });
  });

  it("omits every empty optional company field — no placeholder text", async () => {
    stubFetch("company-a");
    // Isolate the COMPANY-level fields under test — the customer fixture
    // has its own (unrelated) VAT/registration numbers by default.
    render(<InvoiceDocument companyId="company-a" invoice={invoice()} customer={customer({ vatNumber: "", registrationNumber: "" })} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(screen.queryByText(/t\/a/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VAT No:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/N\/A/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not provided/i)).not.toBeInTheDocument();
  });
});
