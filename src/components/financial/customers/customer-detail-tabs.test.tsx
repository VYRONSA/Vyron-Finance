import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CustomerDetailTabs } from "./customer-detail-tabs";
import { buildCustomerFinancialSummary, buildCustomerIntelligence } from "@/server/services/customer-financial-service";
import { MOCK_CUSTOMERS, MOCK_CUSTOMER_ADDRESSES, MOCK_CUSTOMER_CONTACTS } from "@/lib/mock/customer-management-data";
import { MOCK_CUSTOMER_RECEIPTS, MOCK_QUOTATIONS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const CUSTOMER = MOCK_CUSTOMERS[0];
const INVOICES = MOCK_SALES_INVOICES.filter((i) => i.customerId === CUSTOMER.id);
const TODAY = "2026-08-01";

function renderTabs() {
  const financialSummary = buildCustomerFinancialSummary(
    CUSTOMER,
    INVOICES,
    MOCK_CUSTOMER_RECEIPTS.filter((r) => r.customerId === CUSTOMER.id),
    MOCK_QUOTATIONS,
    MOCK_SALES_ORDERS,
    TODAY,
  );
  const intelligence = buildCustomerIntelligence(CUSTOMER, INVOICES, TODAY);
  return render(
    <CustomerDetailTabs
      companyId="co_1"
      customer={CUSTOMER}
      contacts={MOCK_CUSTOMER_CONTACTS[CUSTOMER.id] ?? []}
      addresses={MOCK_CUSTOMER_ADDRESSES[CUSTOMER.id] ?? []}
      financialSummary={financialSummary}
      intelligence={intelligence}
      invoices={INVOICES}
      previewMode
    />,
  );
}

describe("CustomerDetailTabs", () => {
  it("shows Overview as the default active tab", () => {
    renderTabs();
    expect(screen.getByText("Customer Type")).toBeInTheDocument();
  });

  it("switches to the Financial tab and shows real, non-fabricated fields", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Financial" }));
    expect(screen.getByText("Outstanding Balance")).toBeInTheDocument();
    expect(screen.getByText("Age Analysis")).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting Inventory Module").length).toBe(2);
  });

  it("switches to the Sales History tab and lists this customer's documents", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Sales History" }));
    expect(screen.getByText("INV000001")).toBeInTheDocument();
    expect(screen.getByText("INV000002")).toBeInTheDocument();
  });

  it("switches to the Intelligence tab and shows computed signals", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(screen.getByText(/overdue invoice\(s\) totalling/)).toBeInTheDocument();
  });

  it("shows a genuine empty state for a customer with no Sales history", () => {
    const financialSummary = buildCustomerFinancialSummary(MOCK_CUSTOMERS[2], [], [], [], [], TODAY);
    const intelligence = buildCustomerIntelligence(MOCK_CUSTOMERS[2], [], TODAY);
    render(
      <CustomerDetailTabs
        companyId="co_1"
        customer={MOCK_CUSTOMERS[2]}
        contacts={[]}
        addresses={[]}
        financialSummary={financialSummary}
        intelligence={intelligence}
        invoices={[]}
        previewMode
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sales History" }));
    expect(screen.getByText("No sales history yet.")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
