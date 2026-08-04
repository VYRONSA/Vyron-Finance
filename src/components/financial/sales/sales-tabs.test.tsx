import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { SalesTabs } from "./sales-tabs";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";
import { MOCK_CUSTOMER_RECEIPTS, MOCK_DELIVERIES, MOCK_QUOTATIONS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs() {
  return render(
    <SalesTabs
      companyId="co_1"
      previewMode={false}
      customers={MOCK_CUSTOMERS}
      vatTreatments={MOCK_VAT_TREATMENTS}
      quotations={MOCK_QUOTATIONS}
      orders={MOCK_SALES_ORDERS}
      deliveries={MOCK_DELIVERIES}
      invoices={MOCK_SALES_INVOICES}
      receipts={MOCK_CUSTOMER_RECEIPTS}
    />,
  );
}

describe("SalesTabs", () => {
  it("shows Quotations as the default active tab", () => {
    renderTabs();
    expect(screen.getByText("QT000001")).toBeInTheDocument();
  });

  it("switches to the Sales Orders tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Sales Orders" }));
    expect(screen.getByText("SO000001")).toBeInTheDocument();
  });

  it("switches to the Deliveries tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Deliveries" }));
    expect(screen.getByText("DEL000001")).toBeInTheDocument();
  });

  it("switches to the Invoices tab and shows all document types", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
    expect(screen.getByText("INV000001")).toBeInTheDocument();
    expect(screen.getByText("CN000001")).toBeInTheDocument();
    expect(screen.getByText("DN000001")).toBeInTheDocument();
  });

  it("switches to the Receipts tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Receipts" }));
    expect(screen.getByText("RCPT000001")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
