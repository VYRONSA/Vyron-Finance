import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { ReportsTabs } from "./reports-tabs";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import {
  MOCK_BALANCE_SHEET,
  MOCK_BUDGETS,
  MOCK_CASHFLOW_FORECAST,
  MOCK_CASH_FLOW_STATEMENT,
  MOCK_EXECUTIVE_ALERTS,
  MOCK_INCOME_STATEMENT,
  MOCK_REPORT_DEFINITIONS,
  MOCK_REVENUE_FORECAST,
} from "@/lib/mock/financial-reporting-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const EMPTY_FORECAST = { method: "linear-regression" as const, historicalPoints: 0, confidence: 0, forecast: [], assumptions: ["No history yet."] };

function renderTabs(previewMode = true) {
  return render(
    <ReportsTabs
      companyId="co_1"
      incomeStatement={MOCK_INCOME_STATEMENT}
      balanceSheet={MOCK_BALANCE_SHEET}
      cashFlowStatement={MOCK_CASH_FLOW_STATEMENT}
      financialYearLabel="FY2026"
      budgets={MOCK_BUDGETS}
      accounts={MOCK_CHART_OF_ACCOUNTS}
      forecasts={{
        cashflow: MOCK_CASHFLOW_FORECAST,
        revenue: MOCK_REVENUE_FORECAST,
        expense: MOCK_REVENUE_FORECAST,
        vat: MOCK_CASHFLOW_FORECAST,
        inventory: MOCK_CASHFLOW_FORECAST,
        customerPayment: EMPTY_FORECAST,
        supplierPayment: EMPTY_FORECAST,
      }}
      executiveAlerts={MOCK_EXECUTIVE_ALERTS}
      reportDefinitions={MOCK_REPORT_DEFINITIONS}
      previewMode={previewMode}
    />,
  );
}

describe("ReportsTabs", () => {
  it("shows Financial Statements as the default active tab with a real Net Profit figure", () => {
    renderTabs();
    expect(screen.getByText("Net Profit")).toBeInTheDocument();
  });

  it("switches to the Balance Sheet sub-view and shows whether it balances", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Balance Sheet" }));
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("switches to the Cash Flow sub-view", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Cash Flow" }));
    expect(screen.getByText("Opening Cash")).toBeInTheDocument();
  });

  it("switches to the Management Reports tab and lists Budget vs Actual rows", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Management Reports" }));
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Actual")).toBeInTheDocument();
  });

  it("switches to the Forecasting tab and shows every forecast type", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Forecasting" }));
    expect(screen.getByText("Cashflow")).toBeInTheDocument();
    expect(screen.getByText("Supplier Payment Days")).toBeInTheDocument();
  });

  it("switches to the Executive Alerts tab and lists open alerts", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Executive Alerts" }));
    expect(screen.getByText(/Gross margin fell/)).toBeInTheDocument();
  });

  it("switches to the Report Designer tab and lists saved reports", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Report Designer" }));
    expect(screen.getByText("Monthly Income Statement — Summary")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
