import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { AccountActivityView } from "./account-activity-view";
import { MOCK_CHART_OF_ACCOUNTS, MOCK_GL_TRANSACTIONS, MOCK_JOURNALS, buildPreviewAccountActivity, buildPreviewYearComparison } from "@/lib/mock/general-ledger-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const ACCOUNT = MOCK_CHART_OF_ACCOUNTS[0]; // Bank, 1000
const ACTIVITY = buildPreviewAccountActivity(ACCOUNT.id, "2026-06-01", "2026-06-30")!;
const YEAR_COMPARISON = buildPreviewYearComparison(ACCOUNT.id, "2026-06-01", "2026-06-30");
const TRANSACTIONS = MOCK_GL_TRANSACTIONS.filter((t) => t.accountId === ACCOUNT.id && t.postingDate >= "2026-06-01" && t.postingDate <= "2026-06-30");
const RELATED_JOURNALS = MOCK_JOURNALS.filter((j) => TRANSACTIONS.some((t) => t.journalId === j.id));

function renderView() {
  return render(
    <AccountActivityView
      companyId="co_1"
      accountId={ACCOUNT.id}
      account={ACCOUNT}
      activity={ACTIVITY}
      yearComparison={YEAR_COMPARISON}
      transactions={TRANSACTIONS}
      relatedJournals={RELATED_JOURNALS}
      intelligence={{ largestMovements: [], possibleDuplicateJournals: [], unusualGrowth: [], missingPostings: [] }}
      auditEvidence={{ findings: [], workingPapers: [] }}
      previewMode={false}
    />,
  );
}

describe("AccountActivityView", () => {
  it("shows the account's opening and closing balance", () => {
    renderView();
    expect(screen.getByText("Opening Balance")).toBeInTheDocument();
    expect(screen.getByText("Closing Balance")).toBeInTheDocument();
  });

  it("lists the period's transactions", () => {
    renderView();
    for (const t of TRANSACTIONS) {
      expect(screen.getAllByText(t.journalNumber).length).toBeGreaterThan(0);
    }
  });

  it("lists related journals with an expandable history", () => {
    renderView();
    for (const j of RELATED_JOURNALS) {
      expect(screen.getByRole("button", { name: new RegExp(j.journalNumber) })).toBeInTheDocument();
    }
  });

  it("shows a message when there are no Financial Intelligence signals for this account", () => {
    renderView();
    expect(screen.getByText(/no signals for this account/i)).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderView();
    expect(await axe(container)).toHaveNoViolations();
  });
});
