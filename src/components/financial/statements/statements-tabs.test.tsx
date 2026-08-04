import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatementsTabs } from "./statements-tabs";
import { MOCK_DISCLOSURE_NOTES, MOCK_REPORTING_PACKAGES, MOCK_STATEMENT_OF_CHANGES_IN_EQUITY } from "@/lib/mock/financial-statements-data";
import { MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT, MOCK_INCOME_STATEMENT } from "@/lib/mock/financial-reporting-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = true) {
  return render(
    <StatementsTabs
      companyId="co_1"
      incomeStatement={MOCK_INCOME_STATEMENT}
      balanceSheet={MOCK_BALANCE_SHEET}
      cashFlowStatement={MOCK_CASH_FLOW_STATEMENT}
      equityStatement={MOCK_STATEMENT_OF_CHANGES_IN_EQUITY}
      disclosureNotes={MOCK_DISCLOSURE_NOTES}
      reportingPackages={MOCK_REPORTING_PACKAGES}
      periodStart="2026-05-01"
      periodEnd="2026-05-31"
      financialYearStartDate="2026-01-01"
      financialYearLabel="FY2026"
      previewMode={previewMode}
    />,
  );
}

describe("StatementsTabs", () => {
  it("shows Statements & Notes as the default active tab with a real Balance Sheet total", () => {
    renderTabs();
    expect(screen.getByText("Total Assets")).toBeInTheDocument();
  });

  it("switches statement sub-tabs and shows the Statement of Changes in Equity", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Changes in Equity" }));
    expect(screen.getByText("Component")).toBeInTheDocument();
  });

  it("lists generated disclosure notes with completion status", () => {
    renderTabs();
    expect(screen.getByText("Notes to the Financial Statements")).toBeInTheDocument();
    expect(screen.getByText(MOCK_DISCLOSURE_NOTES[0].title)).toBeInTheDocument();
  });

  it("switches to the Reporting Packages tab and lists generated packages", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Reporting Packages" }));
    expect(screen.getAllByText("Management Financial Pack").length).toBeGreaterThan(0);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
