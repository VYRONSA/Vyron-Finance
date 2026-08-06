import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { PurchasingTabs } from "./purchasing-tabs";
import { MOCK_SUPPLIERS, MOCK_BILLS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_VAT_TREATMENTS, MOCK_COST_CENTRES, MOCK_DEPARTMENTS, MOCK_PROJECTS } from "@/lib/mock/company-management-data";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import {
  MOCK_GOODS_RECEIVED_NOTES,
  MOCK_PURCHASE_BILLS,
  MOCK_PURCHASE_ORDERS,
  MOCK_PURCHASE_REQUISITIONS,
  MOCK_SUPPLIER_PAYMENTS,
} from "@/lib/mock/purchasing-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs() {
  return render(
    <PurchasingTabs
      companyId="co_1"
      previewMode={false}
      suppliers={MOCK_SUPPLIERS}
      vatTreatments={MOCK_VAT_TREATMENTS}
      requisitions={MOCK_PURCHASE_REQUISITIONS}
      orders={MOCK_PURCHASE_ORDERS}
      grns={MOCK_GOODS_RECEIVED_NOTES}
      bills={[...MOCK_BILLS, ...MOCK_PURCHASE_BILLS]}
      payments={MOCK_SUPPLIER_PAYMENTS}
      chartOfAccounts={MOCK_CHART_OF_ACCOUNTS}
      costCentres={MOCK_COST_CENTRES}
      projects={MOCK_PROJECTS}
      departments={MOCK_DEPARTMENTS}
    />,
  );
}

describe("PurchasingTabs", () => {
  it("shows Requisitions as the default active tab", () => {
    renderTabs();
    expect(screen.getByText("PR000001")).toBeInTheDocument();
  });

  it("switches to the Purchase Orders tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Purchase Orders" }));
    expect(screen.getByText("PO000001")).toBeInTheDocument();
  });

  it("switches to the GRNs tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "GRNs" }));
    expect(screen.getByText("GRN000001")).toBeInTheDocument();
  });

  it("switches to the Bills tab and shows only Purchasing-origin documents", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Bills" }));
    expect(screen.getByText("FOS-8891")).toBeInTheDocument();
    expect(screen.queryByText("INV-3381")).not.toBeInTheDocument();
  });

  it("switches to the Payments tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Payments" }));
    expect(screen.getByText("PAY000001")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
