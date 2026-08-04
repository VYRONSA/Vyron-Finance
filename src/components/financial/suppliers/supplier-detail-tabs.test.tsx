import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { SupplierDetailTabs } from "./supplier-detail-tabs";
import { buildSupplierFinancialSummary, buildSupplierIntelligence } from "@/server/services/supplier-financial-service";
import { MOCK_SUPPLIERS, MOCK_BILLS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_SUPPLIER_ADDRESSES, MOCK_SUPPLIER_CONTACTS } from "@/lib/mock/supplier-management-data";
import { MOCK_PURCHASE_BILLS, MOCK_SUPPLIER_PAYMENTS } from "@/lib/mock/purchasing-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const SUPPLIER = MOCK_SUPPLIERS[0];
const BILLS = [...MOCK_BILLS, ...MOCK_PURCHASE_BILLS].filter((b) => b.supplierId === SUPPLIER.id);
const TODAY = "2026-08-01";

function renderTabs() {
  const payments = MOCK_SUPPLIER_PAYMENTS.filter((p) => p.supplierId === SUPPLIER.id);
  const financialSummary = buildSupplierFinancialSummary(BILLS, payments, TODAY);
  const intelligence = buildSupplierIntelligence(SUPPLIER, BILLS, TODAY);
  return render(
    <SupplierDetailTabs
      companyId="co_1"
      supplier={SUPPLIER}
      contacts={MOCK_SUPPLIER_CONTACTS[SUPPLIER.id] ?? []}
      addresses={MOCK_SUPPLIER_ADDRESSES[SUPPLIER.id] ?? []}
      financialSummary={financialSummary}
      intelligence={intelligence}
      bills={BILLS}
      previewMode
    />,
  );
}

describe("SupplierDetailTabs", () => {
  it("shows Overview as the default active tab", () => {
    renderTabs();
    expect(screen.getByText("Supplier Type")).toBeInTheDocument();
  });

  it("switches to the Age Analysis tab and shows real, non-fabricated fields", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Age Analysis" }));
    expect(screen.getByText("Outstanding Balance")).toBeInTheDocument();
    expect(screen.getByText("Average Payment Days")).toBeInTheDocument();
  });

  it("switches to the Purchase History tab and lists this supplier's bills", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Purchase History" }));
    expect(screen.getByText("INV-3381")).toBeInTheDocument();
    expect(screen.getByText("FOS-8891")).toBeInTheDocument();
  });

  it("switches to the Intelligence tab and shows computed signals", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(screen.getByText(/overdue bill\(s\) totalling/)).toBeInTheDocument();
  });

  it("shows a genuine empty state for a supplier with no bills", () => {
    const financialSummary = buildSupplierFinancialSummary([], [], TODAY);
    const intelligence = buildSupplierIntelligence(MOCK_SUPPLIERS[2], [], TODAY);
    render(
      <SupplierDetailTabs
        companyId="co_1"
        supplier={MOCK_SUPPLIERS[2]}
        contacts={[]}
        addresses={[]}
        financialSummary={financialSummary}
        intelligence={intelligence}
        bills={[]}
        previewMode
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(screen.getByText("No Supplier Intelligence signals yet.")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
