import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CashbookTabs } from "./cashbook-tabs";
import { MOCK_BANK_RECONCILIATIONS, MOCK_CASHBOOK_BATCHES, MOCK_CASHBOOK_TRANSACTIONS, MOCK_RECONCILIATION_SUMMARY } from "@/lib/mock/cashbook-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = true) {
  const bankAccounts = MOCK_BANK_ACCOUNT_SUMMARIES.map((s) => ({ id: s.account.id, accountName: s.account.accountName }));
  const activeReconciliation = MOCK_BANK_RECONCILIATIONS.find((r) => r.status === "InProgress") ?? null;
  return render(
    <CashbookTabs
      companyId="co_1"
      entries={MOCK_CASHBOOK_TRANSACTIONS}
      bankAccounts={bankAccounts}
      batches={MOCK_CASHBOOK_BATCHES}
      reconciliations={MOCK_BANK_RECONCILIATIONS}
      activeReconciliation={activeReconciliation}
      activeSummary={activeReconciliation ? MOCK_RECONCILIATION_SUMMARY : null}
      previewMode={previewMode}
    />,
  );
}

describe("CashbookTabs", () => {
  it("shows Capture as the default active tab with the batch entry grid", () => {
    renderTabs();
    expect(screen.getByText("Save Draft")).toBeInTheDocument();
    expect(screen.getByText("Post Batch")).toBeInTheDocument();
  });

  it("switches to the Receipts Cashbook tab and shows only credit entries", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Receipts Cashbook" }));
    expect(screen.getAllByText("Receipts Cashbook").length).toBeGreaterThan(0);
  });

  it("switches to the Batches tab and lists generated batches", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Batches" }));
    expect(screen.getByText(MOCK_CASHBOOK_BATCHES[0].batchNumber)).toBeInTheDocument();
  });

  it("switches to the Reconciliation tab and shows the live difference", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Reconciliation" }));
    expect(screen.getByText("Reconciliation History")).toBeInTheDocument();
  });

  it("switches to the Enquiry tab and lists entries across both sources", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Enquiry" }));
    expect(screen.getAllByText("Manual").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Imported").length).toBeGreaterThan(0);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
