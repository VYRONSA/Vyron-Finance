import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { SettingsTabs } from "./settings-tabs";
import type { Company } from "@/server/company-management/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
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
};

function renderTabs(previewMode = false) {
  return render(
    <SettingsTabs
      companyId="co_1"
      company={COMPANY}
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
