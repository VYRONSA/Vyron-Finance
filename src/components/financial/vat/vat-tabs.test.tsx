import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { VatTabs } from "./vat-tabs";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { MOCK_VAT_ADJUSTMENTS, MOCK_VAT_DOCUMENTS, MOCK_VAT_EXCEPTIONS, MOCK_VAT_RETURNS } from "@/lib/mock/vat-data";
import { MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";
import { MOCK_AUDIT_LOG } from "@/lib/mock/automation-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = false) {
  const summary = buildVatDashboardSummary(MOCK_VAT_RETURNS[0], MOCK_VAT_RETURNS, MOCK_VAT_EXCEPTIONS, 0);
  return render(
    <VatTabs
      companyId="co_1"
      summary={summary}
      documents={MOCK_VAT_DOCUMENTS}
      intelligenceSignals={[]}
      exceptions={MOCK_VAT_EXCEPTIONS}
      adjustments={MOCK_VAT_ADJUSTMENTS}
      vatReturns={MOCK_VAT_RETURNS}
      auditLog={MOCK_AUDIT_LOG}
      vatTreatments={MOCK_VAT_TREATMENTS}
      previewMode={previewMode}
    />,
  );
}

describe("VatTabs", () => {
  it("shows Dashboard as the default active tab with a real compliance score", () => {
    renderTabs();
    expect(screen.getByText("Compliance Score")).toBeInTheDocument();
  });

  it("switches to the Transactions tab and lists documents with drill-through", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    expect(screen.getByText("Unregistered Cleaning Co")).toBeInTheDocument();
  });

  it("switches to the Exceptions tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(screen.getByText("Missing VAT Number")).toBeInTheDocument();
  });

  it("switches to the Adjustments tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Adjustments" }));
    expect(screen.getByText(/Correction — VAT claimed twice/)).toBeInTheDocument();
  });

  it("switches to the Returns tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Returns" }));
    expect(screen.getAllByText(/2026-04-01 to 2026-05-31/).length).toBeGreaterThan(0);
  });

  it("switches to the Reports tab and shows a per-treatment breakdown", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Reports" }));
    expect(screen.getByText("VAT by Treatment (all documents on file)")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
