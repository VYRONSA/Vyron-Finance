import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { InventoryTabs } from "./inventory-tabs";
import { buildStockItemIntelligence } from "@/server/services/inventory-intelligence-service";
import {
  MOCK_INTEGRATION_CONNECTIONS,
  MOCK_INVENTORY_TRANSACTIONS,
  MOCK_STOCK_ITEMS,
  MOCK_STOCK_TAKES,
  MOCK_WAREHOUSES,
} from "@/lib/mock/inventory-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs() {
  const today = "2026-08-01";
  const intelligenceSignals = MOCK_STOCK_ITEMS.flatMap((item) =>
    buildStockItemIntelligence(item, MOCK_INVENTORY_TRANSACTIONS, today, null).map((signal) => ({
      stockCode: item.stockCode,
      description: item.description,
      signal,
    })),
  );
  return render(
    <InventoryTabs
      companyId="co_1"
      previewMode={false}
      stockItems={MOCK_STOCK_ITEMS}
      warehouses={MOCK_WAREHOUSES}
      transactions={MOCK_INVENTORY_TRANSACTIONS}
      stockTakes={MOCK_STOCK_TAKES}
      vatTreatments={MOCK_VAT_TREATMENTS}
      intelligenceSignals={intelligenceSignals}
      integrationConnections={MOCK_INTEGRATION_CONNECTIONS}
    />,
  );
}

describe("InventoryTabs", () => {
  it("shows Stock Items as the default active tab", () => {
    renderTabs();
    expect(screen.getByText("SKU-1000")).toBeInTheDocument();
  });

  it("switches to the Warehouses tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Warehouses" }));
    expect(screen.getByText("Main Warehouse")).toBeInTheDocument();
  });

  it("switches to the Transactions tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    expect(screen.getByText("REC000001")).toBeInTheDocument();
  });

  it("switches to the Stock Takes tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Stock Takes" }));
    expect(screen.getByText("ST000001")).toBeInTheDocument();
  });

  it("switches to the Intelligence tab and shows computed signals", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(screen.getByText(/is out of stock/)).toBeInTheDocument();
  });

  it("switches to the Integration Centre tab and shows an honest Not Connected status for both peer VYRON platforms", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Integration Centre" }));
    expect(screen.getByText("VYRON COST")).toBeInTheDocument();
    expect(screen.getByText("VYRON CORE")).toBeInTheDocument();
    expect(screen.getAllByText("Not Connected")).toHaveLength(2);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
