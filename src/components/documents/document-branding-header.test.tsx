import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DocumentBrandingHeader } from "./document-branding-header";

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: "company-a",
    organisationId: "org_1",
    name: "Fenwick & Rowe Ltd",
    industry: "Professional Services",
    status: "active",
    registrationNumber: "2019/123456/07",
    address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3,
    baseCurrencyCode: "ZAR",
    createdAt: "2025-02-10T09:00:00Z",
    tradingName: "",
    vatNumber: "",
    telephone: "",
    email: "",
    website: "",
    postalAddress: "",
    ...overrides,
  };
}

const EMPTY_BRANDING = { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null };
const WITH_LOGO = { hasLogo: true, logoUrl: "https://storage.example/signed-logo-url", logoFilename: "logo.png", logoMimeType: "image/png", logoSizeBytes: 2048, updatedAt: "2026-08-01T00:00:00.000Z" };

function stubFetch(companyId: string, companyBody: unknown, brandingBody: unknown) {
  const fetchMock = vi.fn((url: string) => {
    if (url === `/api/companies/${companyId}`) return Promise.resolve({ ok: true, json: async () => ({ company: companyBody }) });
    if (url === `/api/companies/${companyId}/branding`) return Promise.resolve({ ok: true, json: async () => ({ branding: brandingBody }) });
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentBrandingHeader — reuses the existing company/branding routes", () => {
  it("renders company name, address, and registration number once loaded", async () => {
    stubFetch("company-a", company(), EMPTY_BRANDING);
    render(<DocumentBrandingHeader companyId="company-a" />);
    await waitFor(() => expect(screen.getByText("Fenwick & Rowe Ltd")).toBeInTheDocument());
    expect(screen.getByText("12 Fenwick Street, Cape Town")).toBeInTheDocument();
    expect(screen.getByText(/2019\/123456\/07/)).toBeInTheDocument();
  });

  it("renders the logo image when a logo exists", async () => {
    stubFetch("company-a", company(), WITH_LOGO);
    render(<DocumentBrandingHeader companyId="company-a" />);
    const img = await screen.findByRole("img", { name: /logo/i });
    expect(img).toHaveAttribute("src", WITH_LOGO.logoUrl);
  });

  it("renders correctly with no logo — no broken image, no placeholder icon markup", async () => {
    stubFetch("company-a", company(), EMPTY_BRANDING);
    render(<DocumentBrandingHeader companyId="company-a" />);
    await waitFor(() => expect(screen.getByText("Fenwick & Rowe Ltd")).toBeInTheDocument());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("never renders a broken image — hides the logo if the signed URL fails to load", async () => {
    stubFetch("company-a", company(), WITH_LOGO);
    render(<DocumentBrandingHeader companyId="company-a" />);
    const img = await screen.findByRole("img", { name: /logo/i });
    fireEvent.error(img);
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });

  it("fetches only the given company's data — never another company's (tenant isolation)", async () => {
    const fetchMock = stubFetch("company-a", company({ name: "Company A" }), WITH_LOGO);
    render(<DocumentBrandingHeader companyId="company-a" />);
    await screen.findByText("Company A");

    const calledUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calledUrls).toContain("/api/companies/company-a");
    expect(calledUrls).toContain("/api/companies/company-a/branding");
    expect(calledUrls.some((u) => String(u).includes("company-b"))).toBe(false);
  });

  it("renders Company B's own name and logo when given Company B's id — never Company A's", async () => {
    stubFetch("company-b", company({ id: "company-b", name: "Netherfield Logistics" }), { ...WITH_LOGO, logoUrl: "https://storage.example/company-b-logo" });
    render(<DocumentBrandingHeader companyId="company-b" />);
    await waitFor(() => expect(screen.getByText("Netherfield Logistics")).toBeInTheDocument());
    const img = await screen.findByRole("img", { name: /logo/i });
    expect(img).toHaveAttribute("src", "https://storage.example/company-b-logo");
    expect(screen.queryByText("Fenwick & Rowe Ltd")).not.toBeInTheDocument();
  });
});

describe("DocumentBrandingHeader — Phase 20D expanded company profile", () => {
  it("shows trading name, registration number, VAT number, and contact information when present", async () => {
    stubFetch(
      "company-a",
      company({
        tradingName: "Fenwick & Rowe",
        vatNumber: "4123456789",
        telephone: "021 555 0123",
        email: "accounts@fenwickrowe.co.za",
        website: "www.fenwickrowe.co.za",
      }),
      EMPTY_BRANDING,
    );
    render(<DocumentBrandingHeader companyId="company-a" />);

    await waitFor(() => expect(screen.getByText("t/a Fenwick & Rowe")).toBeInTheDocument());
    expect(screen.getByText(/VAT No: 4123456789/)).toBeInTheDocument();
    expect(screen.getByText(/021 555 0123/)).toBeInTheDocument();
    expect(screen.getByText(/accounts@fenwickrowe\.co\.za/)).toBeInTheDocument();
    expect(screen.getByText(/www\.fenwickrowe\.co\.za/)).toBeInTheDocument();
  });

  it("shows the postal address only when it differs from the physical address", async () => {
    stubFetch("company-a", company({ address: "12 Fenwick Street", postalAddress: "PO Box 1234" }), EMPTY_BRANDING);
    render(<DocumentBrandingHeader companyId="company-a" />);
    await waitFor(() => expect(screen.getByText(/Postal: PO Box 1234/)).toBeInTheDocument());
  });

  it("does not repeat the address when the postal address is the same as the physical address", async () => {
    stubFetch("company-a", company({ address: "12 Fenwick Street", postalAddress: "12 Fenwick Street" }), EMPTY_BRANDING);
    render(<DocumentBrandingHeader companyId="company-a" />);
    await waitFor(() => expect(screen.getByText("12 Fenwick Street")).toBeInTheDocument());
    expect(screen.queryByText(/Postal:/)).not.toBeInTheDocument();
  });

  it("omits every empty optional field entirely — no 'N/A' or 'Not provided' placeholder text", async () => {
    stubFetch("company-a", company(), EMPTY_BRANDING);
    render(<DocumentBrandingHeader companyId="company-a" />);
    await waitFor(() => expect(screen.getByText("Fenwick & Rowe Ltd")).toBeInTheDocument());

    expect(screen.queryByText(/t\/a/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VAT No:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Postal:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/N\/A/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not provided/i)).not.toBeInTheDocument();
  });

  it("never displays Company B's trading name, VAT number, or contact information on Company A's document", async () => {
    stubFetch(
      "company-a",
      company({ id: "company-a", tradingName: "Company A Trading", vatNumber: "1111111111" }),
      EMPTY_BRANDING,
    );
    render(<DocumentBrandingHeader companyId="company-a" />);

    await waitFor(() => expect(screen.getByText("t/a Company A Trading")).toBeInTheDocument());
    expect(screen.queryByText(/2222222222/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Company B Trading/)).not.toBeInTheDocument();
  });
});
