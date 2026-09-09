import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { SettingsTabs } from "./settings-tabs";
import type { Company } from "@/server/company-management/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

const COMPANY: Company = {
  id: "co_1",
  organisationId: "org_1",
  name: "Harlow Retail Group",
  industry: "Retail",
  status: "active",
  registrationNumber: "2018/654321/07",
  address: "44 Harlow Road",
  financialYearStartMonth: 3,
  baseCurrencyCode: "ZAR",
  createdAt: "2025-01-14T09:00:00Z",
  tradingName: "",
  vatNumber: "",
  telephone: "",
  email: "",
  website: "",
  postalAddress: "",
  city: "", province: "", postalCode: "", country: "",
};

const EMPTY_BRANDING = { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null };

function renderTabs(previewMode = false) {
  return render(
    <SettingsTabs
      companyId="co_1"
      company={COMPANY}
      branding={EMPTY_BRANDING}
      financialYears={[]}
      suggestedFinancialYear={{ yearLabel: "FY2027", startDate: "2026-03-01", endDate: "2027-02-28" }}
      branches={[]}
      departments={[]}
      costCentres={[]}
      projects={[]}
      currencies={[{ code: "ZAR", name: "South African Rand", symbol: "R" }]}
      companyCurrencies={[]}
      vatTreatments={[]}
      roles={[]}
      roleAssignments={[]}
      previewMode={previewMode}
    />,
  );
}

describe("SettingsTabs", () => {
  it("shows Company Details as the default active tab, pre-filled with real data", () => {
    renderTabs();
    expect(screen.getByDisplayValue("Harlow Retail Group")).toBeInTheDocument();
  });

  it("switches to the Branding tab and shows its empty state", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Branding" }));
    expect(screen.getByRole("button", { name: /upload logo/i })).toBeInTheDocument();
  });

  it("switches to the Bank Statement Email tab and shows the address once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bankStatementEmail: {
            id: 1, companyId: "co_1", stableIdentifier: "harlow-retail-group-a7k3", status: "active",
            createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
            lastReceivedAt: null, lastSuccessfulImportAt: null, lastFailureAt: null,
            emailAddress: "harlow-retail-group-a7k3.bank@imports.vyronfinance.co.za",
          },
        }),
      }),
    );
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Bank Statement Email" }));
    await screen.findByText("harlow-retail-group-a7k3.bank@imports.vyronfinance.co.za");
    vi.unstubAllGlobals();
  });

  it("switches to the Financial Years tab and shows its empty state", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Financial Years" }));
    expect(screen.getByText(/no financial years yet/i)).toBeInTheDocument();
  });

  it("switches to the Branches tab and shows its empty state", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Branches" }));
    expect(screen.getByText(/no branches yet/i)).toBeInTheDocument();
  });

  it("switches to the Projects tab and shows its empty state", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });

  it("switches to the Tax Configuration tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Tax Configuration" }));
    expect(screen.getByPlaceholderText(/reduced rate/i)).toBeInTheDocument();
  });

  it("switches to the Currencies tab and marks the base currency", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Currencies" }));
    expect(screen.getByText("Base Currency")).toBeInTheDocument();
  });

  it("switches to the Roles & Permissions tab and shows its empty state", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Roles & Permissions" }));
    expect(screen.getByText("No role selected.")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
