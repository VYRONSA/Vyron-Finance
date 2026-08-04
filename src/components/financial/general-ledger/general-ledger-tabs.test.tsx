import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { GeneralLedgerTabs } from "./general-ledger-tabs";
import { buildAccountTree } from "@/server/services/chart-of-accounts-service";
import { MOCK_CHART_OF_ACCOUNTS, MOCK_GL_TRANSACTIONS, MOCK_JOURNALS, MOCK_POSTING_RULES, MOCK_TRIAL_BALANCE } from "@/lib/mock/general-ledger-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs() {
  return render(
    <GeneralLedgerTabs
      companyId="co_1"
      previewMode={false}
      accounts={MOCK_CHART_OF_ACCOUNTS}
      accountTree={buildAccountTree(MOCK_CHART_OF_ACCOUNTS)}
      journals={MOCK_JOURNALS}
      postingRules={MOCK_POSTING_RULES}
      trialBalance={MOCK_TRIAL_BALANCE}
      initialGlPage={{ transactions: MOCK_GL_TRANSACTIONS, nextCursor: null, hasMore: false, runningBalances: null }}
      branches={[]}
      departments={[]}
      costCentres={[]}
    />,
  );
}

describe("GeneralLedgerTabs", () => {
  it("shows Chart of Accounts as the default active tab", () => {
    renderTabs();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("Bank")).toBeInTheDocument();
  });

  it("switches to the Journals tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Journals" }));
    expect(screen.getByText("JR000001")).toBeInTheDocument();
  });

  it("switches to the Posting Rules tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Posting Rules" }));
    expect(screen.getByText("Sales Invoice")).toBeInTheDocument();
  });

  it("switches to the Trial Balance tab and shows the balanced indicator", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Trial Balance" }));
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("switches to the GL Inquiry tab", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "GL Inquiry" }));
    expect(screen.getAllByText(/1000/).length).toBeGreaterThan(0);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
