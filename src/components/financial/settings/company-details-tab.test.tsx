import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { CompanyDetailsTab } from "./company-details-tab";
import type { Company } from "@/server/company-management/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const CURRENCIES = [{ code: "ZAR", name: "South African Rand", symbol: "R" }];

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "co_1", organisationId: "org_1", name: "Fenwick & Rowe Ltd", industry: "Professional Services",
    status: "active", registrationNumber: "2019/123456/07", address: "12 Fenwick Street, Cape Town",
    financialYearStartMonth: 3, baseCurrencyCode: "ZAR", createdAt: "2025-02-10T09:00:00Z",
    tradingName: "", vatNumber: "", telephone: "", email: "", website: "", postalAddress: "",
    city: "", province: "", postalCode: "", country: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CompanyDetailsTab — Phase 20D profile fields load correctly", () => {
  it("pre-fills every new field from the company prop", () => {
    render(
      <CompanyDetailsTab
        company={company({ tradingName: "Fenwick & Rowe", vatNumber: "4123456789", telephone: "021 555 0123", email: "accounts@fenwickrowe.co.za", website: "www.fenwickrowe.co.za", postalAddress: "PO Box 1234" })}
        currencies={CURRENCIES}
        previewMode={false}
      />,
    );
    expect(screen.getByDisplayValue("Fenwick & Rowe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4123456789")).toBeInTheDocument();
    expect(screen.getByDisplayValue("021 555 0123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("accounts@fenwickrowe.co.za")).toBeInTheDocument();
    expect(screen.getByDisplayValue("www.fenwickrowe.co.za")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PO Box 1234")).toBeInTheDocument();
  });

  it("relabels the existing address field as Physical Address without changing its binding", () => {
    render(<CompanyDetailsTab company={company({ address: "12 Fenwick Street" })} currencies={CURRENCIES} previewMode={false} />);
    expect(screen.getByLabelText("Physical Address")).toHaveValue("12 Fenwick Street");
  });

  it("renders blank optional fields as empty inputs, not placeholders", () => {
    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    expect(screen.getByLabelText("Trading Name")).toHaveValue("");
    expect(screen.getByLabelText("VAT Number")).toHaveValue("");
    expect(screen.getByLabelText("Postal Address")).toHaveValue("");
  });
});

describe("CompanyDetailsTab — Phase 20D profile fields save correctly", () => {
  it("saves every new field in the PATCH body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: company() }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    fireEvent.change(screen.getByLabelText("Trading Name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("VAT Number"), { target: { value: "4123456789" } });
    fireEvent.change(screen.getByLabelText("Telephone"), { target: { value: "011 000 0000" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "info@acme.co.za" } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "acme.co.za" } });
    fireEvent.change(screen.getByLabelText("Postal Address"), { target: { value: "PO Box 1" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      tradingName: "Acme", vatNumber: "4123456789", telephone: "011 000 0000",
      email: "info@acme.co.za", website: "acme.co.za", postalAddress: "PO Box 1",
    });
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
  });

  it("saves successfully with every optional field left blank", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: company() }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.tradingName).toBe("");
    expect(body.vatNumber).toBe("");
  });

  it("shows the server's validation error for an invalid email without crashing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Email is not a valid email address." }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Email is not a valid email address."));
  });

  it("shows the server's validation error for an invalid website without crashing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Website is not a valid website address." }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "not a valid website" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Website is not a valid website address."));
  });
});

describe("CompanyDetailsTab — regression", () => {
  it("still saves the existing fields (name, industry, registration number, base currency)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: company() }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Fenwick & Rowe Ltd");
    expect(body.registrationNumber).toBe("2019/123456/07");
    expect(body.baseCurrencyCode).toBe("ZAR");
  });

  it("disables Save Changes in Preview Mode with an explanatory title", () => {
    render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode />);
    const saveButton = screen.getByRole("button", { name: /save changes/i });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("title", expect.stringContaining("Supabase"));
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<CompanyDetailsTab company={company()} currencies={CURRENCIES} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
