import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StatementDocument } from "./statement-document";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";

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

function entry(overrides: Partial<StatementEntry> = {}): StatementEntry {
  return { date: "2026-08-01", type: "Invoice", reference: "INV-0001", documentId: 1, debit: 1150, credit: 0, balance: 1150, ...overrides };
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

describe("StatementDocument — rendering", () => {
  it("renders nothing when closed", () => {
    stubFetch("company-a");
    const { container } = render(
      <StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[]} open={false} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders with the company logo", async () => {
    stubFetch("company-a", WITH_LOGO);
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[entry()]} open onClose={vi.fn()} />);
    const img = await screen.findByRole("img", { name: /logo/i });
    expect(img).toHaveAttribute("src", WITH_LOGO.logoUrl);
  });

  it("renders correctly without a logo", async () => {
    stubFetch("company-a", EMPTY_BRANDING);
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[entry()]} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Acme Retail")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("uses the correct company's branding (fetches the given companyId, not another)", async () => {
    const fetchMock = stubFetch("company-a", WITH_LOGO);
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[entry()]} open onClose={vi.fn()} />);
    await screen.findByRole("img", { name: /logo/i });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/companies/company-a/branding");
    expect(urls.some((u) => u.includes("company-b"))).toBe(false);
  });

  it("displays statement balances exactly as computed by buildCustomerStatement — never recomputed", async () => {
    stubFetch("company-a");
    const entries = [entry({ date: "2026-08-01", debit: 1150, credit: 0, balance: 1150 }), entry({ date: "2026-08-15", type: "Receipt", reference: "RCPT-0002", debit: 0, credit: 1150, balance: 0 })];
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={entries} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(money(1150)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(money(0)).length).toBeGreaterThan(0); // opening balance + closing balance
    });
  });

  it("shows every existing statement entry unchanged, in order", async () => {
    stubFetch("company-a");
    const entries = [entry({ reference: "INV-0001" }), entry({ reference: "RCPT-0002", type: "Receipt" })];
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={entries} open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("INV-0001")).toBeInTheDocument();
      expect(screen.getByText("RCPT-0002")).toBeInTheDocument();
    });
  });

  it("shows the customer's VAT and registration number where available, and omits them when not", async () => {
    stubFetch("company-a");
    render(
      <StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail", vatNumber: "4123456789" }} entries={[entry()]} open onClose={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(/4123456789/)).toBeInTheDocument());
    // Only the COMPANY's own "Reg No:" (from DocumentBrandingHeader) is
    // present — the customer has no registrationNumber here, so no
    // second "Reg No:" line should appear for them.
    expect(screen.getAllByText(/Reg No:/)).toHaveLength(1);
  });

  it("renders an honest empty state, not a fabricated statement, when a customer has no activity", async () => {
    stubFetch("company-a");
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[]} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no posted invoices or receipts/i)).toBeInTheDocument());
  });
});

describe("StatementDocument — Phase 20D expanded company profile (same DocumentBrandingHeader as InvoiceDocument)", () => {
  it("displays the company's Trading Name, VAT Number, and contact information when present", async () => {
    stubFetch("company-a", EMPTY_BRANDING, {
      tradingName: "Fenwick & Rowe",
      vatNumber: "4123456789",
      telephone: "021 555 0123",
      email: "accounts@fenwickrowe.co.za",
      website: "www.fenwickrowe.co.za",
    });
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[entry()]} open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("t/a Fenwick & Rowe")).toBeInTheDocument();
      expect(screen.getByText(/VAT No: 4123456789/)).toBeInTheDocument();
      expect(screen.getByText(/021 555 0123/)).toBeInTheDocument();
      expect(screen.getByText(/accounts@fenwickrowe\.co\.za/)).toBeInTheDocument();
      expect(screen.getByText(/www\.fenwickrowe\.co\.za/)).toBeInTheDocument();
    });
  });

  it("omits every empty optional company field — no placeholder text", async () => {
    stubFetch("company-a");
    render(<StatementDocument companyId="company-a" customer={{ id: 10, name: "Acme Retail" }} entries={[entry()]} open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Acme Retail")).toBeInTheDocument());
    expect(screen.queryByText(/t\/a/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VAT No:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/N\/A/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not provided/i)).not.toBeInTheDocument();
  });
});
