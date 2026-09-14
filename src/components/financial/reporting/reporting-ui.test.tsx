import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReportResult, ReportSection } from "@/server/report-centre/types";
import type { ReportCatalogEntry } from "@/server/report-centre/registry";
import { ReportTable } from "./report-table";
import { ReportChecks } from "./report-parts";
import { ReportFilterBar, periodPresets } from "./report-filter-bar";
import { drillHref, reportHref } from "./drill-href";
import { formatMoney } from "./format";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }) }));

beforeEach(() => push.mockReset());

const HOME = { "customer-statement": "customers", "customer-ledger": "customers", "journal-detail": "general-ledger", "bank-transaction-detail": "banking", "gl-account-activity": "general-ledger" } as const;

const SECTION: ReportSection = {
  columns: [
    { key: "name", label: "Customer", kind: "text" },
    { key: "balance", label: "Balance", kind: "money" },
  ],
  rows: [
    { kind: "group", cells: { name: "Group A" } },
    { kind: "detail", level: 1, cells: { name: "Acme Retail", balance: 920 }, drill: { kind: "report", reportId: "customer-statement", filters: { customerId: "1", dateTo: "2026-07-31" } } },
    { kind: "detail", level: 1, cells: { name: "Refund due", balance: -80 }, drill: { kind: "bank-transaction", transactionId: 101 } },
    { kind: "total", cells: { name: "Total", balance: 840 } },
  ],
};

describe("formatting", () => {
  it("shows money with two decimals and negatives in parentheses", () => {
    expect(formatMoney(1234.5)).toBe("1,234.50");
    expect(formatMoney(-80)).toBe("(80.00)");
  });
});

describe("drill-down links", () => {
  it("map every kind of target to its page", () => {
    expect(drillHref("co", HOME, { kind: "report", reportId: "customer-statement", filters: { customerId: "1" } })).toBe("/company/co/reporting/customers?report=customer-statement&customerId=1");
    expect(drillHref("co", HOME, { kind: "document", docType: "sales-invoice", id: 7 })).toBe("/company/co/reporting/documents/sales-invoice/7");
    expect(drillHref("co", HOME, { kind: "journal", journalId: 3 })).toBe("/company/co/reporting/general-ledger?report=journal-detail&journalId=3");
    expect(drillHref("co", HOME, { kind: "bank-transaction", transactionId: 101 })).toBe("/company/co/reporting/banking?report=bank-transaction-detail&transactionId=101");
    expect(reportHref("co", HOME, "gl-account-activity", { accountId: "2", dateFrom: "" })).toBe("/company/co/reporting/general-ledger?report=gl-account-activity&accountId=2");
  });
});

describe("ReportTable", () => {
  it("renders drill-downs as links on the row's first cell, and money right-aligned", () => {
    render(<ReportTable section={SECTION} companyId="co" reportHome={HOME} />);
    expect(screen.getByRole("link", { name: "Acme Retail" })).toHaveAttribute("href", "/company/co/reporting/customers?report=customer-statement&customerId=1&dateTo=2026-07-31");
    expect(screen.getByRole("link", { name: "Refund due" })).toHaveAttribute("href", "/company/co/reporting/banking?report=bank-transaction-detail&transactionId=101");
    const negative = screen.getByText("(80.00)");
    expect(negative.closest("td")).toHaveClass("text-right");
  });

  it("renders plain text with no links for the printed document", () => {
    render(<ReportTable section={SECTION} companyId="co" reportHome={HOME} interactive={false} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Acme Retail")).toBeInTheDocument();
  });

  it("shows the section's empty message rather than an empty table", () => {
    render(<ReportTable section={{ ...SECTION, rows: [], emptyMessage: "Nothing outstanding." }} companyId="co" reportHome={HOME} />);
    expect(screen.getByText("Nothing outstanding.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<ReportTable section={SECTION} companyId="co" reportHome={HOME} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ReportChecks", () => {
  it("never hides a failed reconciliation: shows the difference and the explanation", () => {
    render(
      <ReportChecks
        checks={[
          { label: "Trial Balance balances", expected: 100, actual: 100, difference: 0, passed: true },
          { label: "Customer ledger equals Debtors", expected: 2720, actual: 2220, difference: -500, passed: false, explanation: "A manual journal hit Debtors." },
        ]}
      />,
    );
    expect(screen.getByText("1 of 2 reconciliation checks failed")).toBeInTheDocument();
    expect(screen.getByText(/difference \(500\.00\)/)).toBeInTheDocument();
    expect(screen.getByText("A manual journal hit Debtors.")).toBeInTheDocument();
  });
});

describe("ReportFilterBar", () => {
  const specs = [
    { key: "customerId" as const, label: "Customer", control: "select" as const, options: "customers" as const, required: true },
    { key: "dateFrom" as const, label: "From", control: "date" as const },
    { key: "dateTo" as const, label: "To", control: "date" as const },
  ];

  it("asks for a required filter and applies the chosen values", () => {
    const onApply = vi.fn();
    render(<ReportFilterBar specs={specs} values={{ dateFrom: "2026-03-01", dateTo: "2026-07-31" }} options={{ customerId: [{ value: "1", label: "Acme Retail" }] }} today="2026-07-31" fyStart="2026-03-01" onApply={onApply} />);
    expect(screen.getByRole("option", { name: "Choose customer…" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Customer/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    expect(onApply).toHaveBeenCalledWith({ customerId: "1", dateFrom: "2026-03-01", dateTo: "2026-07-31" });
  });

  it("offers period presets in the company's financial year", () => {
    const presets = periodPresets("2026-07-31", "2026-03-01");
    expect(presets.find((p) => p.label === "Year to date")).toMatchObject({ dateFrom: "2026-03-01", dateTo: "2026-07-31" });
    expect(presets.find((p) => p.label === "Last month")).toMatchObject({ dateFrom: "2026-06-01", dateTo: "2026-06-30" });
    expect(presets.find((p) => p.label === "Last financial year")).toMatchObject({ dateFrom: "2025-03-01", dateTo: "2026-02-28" });
    const onApply = vi.fn();
    render(<ReportFilterBar specs={specs} values={{}} options={{}} today="2026-07-31" fyStart="2026-03-01" onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Last month" }));
    expect(onApply).toHaveBeenCalledWith({ dateFrom: "2026-06-01", dateTo: "2026-06-30" });
  });
});

describe("ReportWorkspace", async () => {
  const { ReportWorkspace } = await import("./report-workspace");
  const statement: ReportCatalogEntry = { id: "customer-statement", title: "Customer Statement", description: "A statement.", categories: ["customers"], filters: [{ key: "customerId", label: "Customer", control: "select", options: "customers", required: true }], emailable: true };
  const ledger: ReportCatalogEntry = { id: "customer-ledger", title: "Customer Ledger", description: "The ledger.", categories: ["customers"], filters: [], emailable: false };
  const result: ReportResult = { reportId: "customer-statement", title: "Customer Statement", subtitle: "Acme · period", generatedAt: "2026-07-31T10:00:00.000Z", summary: [{ label: "Amount Due", value: 920, kind: "money" }], sections: [SECTION], checks: [], notices: ["Note A"] };
  const base = { companyId: "co", category: "customers" as const, reports: [statement, ledger], reportHome: HOME, today: "2026-07-31", fyStart: "2026-03-01", filterOptions: {} };

  it("lists the category's reports and opens one keeping the period", () => {
    render(<ReportWorkspace {...base} selected={null} result={null} inputError={null} filters={{ dateFrom: "2026-04-01", dateTo: "2026-07-31" }} previewMode={false} />);
    const list = screen.getByRole("complementary", { name: "Reports in this category" });
    fireEvent.click(within(list).getByRole("button", { name: "Customer Ledger" }));
    expect(push).toHaveBeenCalledWith("/company/co/reporting/customers?report=customer-ledger&dateFrom=2026-04-01&dateTo=2026-07-31");
  });

  it("offers Print, PDF, Excel and CSV with the report's own filters, and Email only with a customer", () => {
    render(<ReportWorkspace {...base} selected={statement} result={result} inputError={null} filters={{ customerId: "1", dateFrom: "2026-03-01", dateTo: "2026-07-31" }} previewMode={false} />);
    expect(screen.getByRole("link", { name: "Print" })).toHaveAttribute("href", "/company/co/reporting/print/customer-statement?customerId=1&dateFrom=2026-03-01&dateTo=2026-07-31");
    expect(screen.getByRole("link", { name: /PDF/ })).toHaveAttribute("href", "/api/companies/co/reporting/customer-statement/export?customerId=1&dateFrom=2026-03-01&dateTo=2026-07-31&format=pdf");
    expect(screen.getByRole("link", { name: /Excel/ }).getAttribute("href")).toContain("format=xlsx");
    expect(screen.getByRole("link", { name: /CSV/ }).getAttribute("href")).toContain("format=csv");
    expect(screen.getByRole("button", { name: "Email" })).toBeEnabled();
    expect(screen.getByText("Note A")).toBeInTheDocument();
  });

  it("disables Email in Preview Mode", () => {
    render(<ReportWorkspace {...base} selected={statement} result={result} inputError={null} filters={{ customerId: "1" }} previewMode />);
    expect(screen.getByRole("button", { name: "Email" })).toBeDisabled();
  });

  it("shows the missing-filter prompt instead of a report", () => {
    render(<ReportWorkspace {...base} selected={statement} result={null} inputError="Choose a customer to run the Customer Statement." filters={{}} previewMode={false} />);
    expect(screen.getByText("Choose a customer to run the Customer Statement.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Print" })).not.toBeInTheDocument();
  });
});
