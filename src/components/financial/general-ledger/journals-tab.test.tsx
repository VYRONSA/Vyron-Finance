import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { JournalsTab } from "./journals-tab";
import type { Journal } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const refresh = vi.fn();
const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, back: vi.fn() }),
  useSearchParams: () => searchParams,
}));

function journal(overrides: Partial<Journal> & Pick<Journal, "id" | "journalNumber" | "status">): Journal {
  return {
    companyId: "co_1",
    journalDate: "2026-07-15",
    journalType: "Manual",
    description: "Test journal",
    reference: "",
    sourceType: "manual",
    sourceId: null,
    totalDebit: 500,
    totalCredit: 500,
    createdAt: "2026-07-15T09:00:00Z",
    postedAt: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    isReversed: false,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    postingBatchId: null,
    lines: [
      { id: 1, journalId: overrides.id, accountCode: "1000", debit: 500, credit: 0, description: "", lineOrder: 0 },
      { id: 2, journalId: overrides.id, accountCode: "4000", debit: 0, credit: 500, description: "", lineOrder: 1 },
    ],
    ...overrides,
  };
}

const ACCOUNTS: ChartOfAccount[] = [
  { id: 1, companyId: "co_1", accountCode: "1000", description: "Bank", accountType: "Asset", category: "", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, companyId: "co_1", accountCode: "4000", description: "Sales", accountType: "Income", category: "", normalBalance: "Credit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z" },
];

describe("JournalsTab", () => {
  beforeEach(() => {
    refresh.mockClear();
    push.mockClear();
    searchParams = new URLSearchParams();
  });

  it("shows Edit and Submit for a Draft journal", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Draft" })]} accounts={ACCOUNTS} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^submit$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("shows Approve and Reject for a Submitted journal", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Submitted" })]} accounts={ACCOUNTS} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^submit$/i })).not.toBeInTheDocument();
  });

  it("shows Cancel for an Approved journal", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Approved" })]} accounts={ACCOUNTS} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("shows Reverse for a Posted, not-yet-reversed journal, but not for one already reversed", () => {
    const { rerender } = render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Posted", isReversed: false })]} accounts={ACCOUNTS} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^reverse$/i })).toBeInTheDocument();

    rerender(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Posted", isReversed: true })]} accounts={ACCOUNTS} previewMode={false} />);
    expect(screen.queryByRole("button", { name: /^reverse$/i })).not.toBeInTheDocument();
  });

  it("shows no workflow action for a terminal Rejected or Cancelled journal, but always shows Copy", () => {
    render(
      <JournalsTab
        companyId="co_1"
        journals={[journal({ id: 1, journalNumber: "JR000001", status: "Rejected" }), journal({ id: 2, journalNumber: "JR000002", status: "Cancelled" })]}
        accounts={ACCOUNTS}
        previewMode={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^copy$/i })).toHaveLength(2);
  });

  it("disables every workflow action in Preview Mode", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Draft" })]} accounts={ACCOUNTS} previewMode />);
    const submitButton = screen.getByRole("button", { name: /^submit$/i });
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute("title", expect.stringContaining("Supabase"));
    expect(screen.getByRole("button", { name: /new journal/i })).toBeDisabled();
  });

  it("opens the New Journal form with a live balance indicator", () => {
    render(<JournalsTab companyId="co_1" journals={[]} accounts={ACCOUNTS} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /new journal/i }));
    expect(screen.getByRole("button", { name: /create draft journal/i })).toBeInTheDocument();
    // Two blank lines by default, nothing entered yet — not balanced (zero debit).
    expect(screen.getByText(/not balanced/i)).toBeInTheDocument();
  });

  it("filters by status and by search text", () => {
    render(
      <JournalsTab
        companyId="co_1"
        journals={[
          journal({ id: 1, journalNumber: "JR000001", status: "Draft", description: "Bank fees" }),
          journal({ id: 2, journalNumber: "JR000002", status: "Posted", description: "Sales invoice" }),
        ]}
        accounts={ACCOUNTS}
        previewMode={false}
      />,
    );
    expect(screen.getByText("JR000001")).toBeInTheDocument();
    expect(screen.getByText("JR000002")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search journal/i), { target: { value: "Sales" } });
    expect(screen.queryByText("JR000001")).not.toBeInTheDocument();
    expect(screen.getByText("JR000002")).toBeInTheDocument();
  });

  it("pre-filters to a journal deep-linked via ?journal=", () => {
    searchParams = new URLSearchParams({ journal: "JR000002" });
    render(
      <JournalsTab
        companyId="co_1"
        journals={[
          journal({ id: 1, journalNumber: "JR000001", status: "Draft" }),
          journal({ id: 2, journalNumber: "JR000002", status: "Posted" }),
        ]}
        accounts={ACCOUNTS}
        previewMode={false}
      />,
    );
    expect(screen.queryByText("JR000001")).not.toBeInTheDocument();
    expect(screen.getByText("JR000002")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(
      <JournalsTab
        companyId="co_1"
        journals={[
          journal({ id: 1, journalNumber: "JR000001", status: "Draft" }),
          journal({ id: 2, journalNumber: "JR000002", status: "Posted" }),
        ]}
        accounts={ACCOUNTS}
        previewMode={false}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
