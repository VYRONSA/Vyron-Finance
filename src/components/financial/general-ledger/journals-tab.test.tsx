import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { JournalsTab, journalMatchesDimensions } from "./journals-tab";
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
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Draft" })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^submit$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("shows Approve and Reject for a Submitted journal", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Submitted" })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^submit$/i })).not.toBeInTheDocument();
  });

  it("shows Cancel for an Approved journal", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Approved" })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("shows Reverse for a Posted, not-yet-reversed journal, but not for one already reversed", () => {
    const { rerender } = render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Posted", isReversed: false })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);
    expect(screen.getByRole("button", { name: /^reverse$/i })).toBeInTheDocument();

    rerender(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Posted", isReversed: true })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);
    expect(screen.queryByRole("button", { name: /^reverse$/i })).not.toBeInTheDocument();
  });

  it("Finding #192 (RC-3) — Reverse requires confirmation before calling the API", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Posted", isReversed: false })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);

    fireEvent.click(screen.getByRole("button", { name: /^reverse$/i }));
    expect(screen.getByText(/reverse this journal/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByRole("button", { name: /^reverse$/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Finding #211 (RC-3) — Post Approved Journals requires confirmation before calling the API", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Approved" })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);

    fireEvent.click(screen.getByRole("button", { name: /post approved journals/i }));
    expect(screen.getByText(/post 1 journal to the general ledger\?/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows no workflow action for a terminal Rejected or Cancelled journal, but always shows Copy", () => {
    render(
      <JournalsTab
        companyId="co_1"
        journals={[journal({ id: 1, journalNumber: "JR000001", status: "Rejected" }), journal({ id: 2, journalNumber: "JR000002", status: "Cancelled" })]}
        accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]}
        previewMode={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^copy$/i })).toHaveLength(2);
  });

  it("disables every workflow action in Preview Mode", () => {
    render(<JournalsTab companyId="co_1" journals={[journal({ id: 1, journalNumber: "JR000001", status: "Draft" })]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode />);
    const submitButton = screen.getByRole("button", { name: /^submit$/i });
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveAttribute("title", expect.stringContaining("Supabase"));
    expect(screen.getByRole("button", { name: /new journal/i })).toBeDisabled();
  });

  it("opens the New Journal form with a live balance indicator", () => {
    render(<JournalsTab companyId="co_1" journals={[]} accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]} previewMode={false} />);
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
        accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]}
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
        accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]}
        previewMode={false}
      />,
    );
    expect(screen.queryByText("JR000001")).not.toBeInTheDocument();
    expect(screen.getByText("JR000002")).toBeInTheDocument();
  });

  // Master Implementation Tracker — Epic E1, Finding #227.
  describe("journalMatchesDimensions", () => {
    const branchAAccount: ChartOfAccount = { ...ACCOUNTS[0], accountCode: "6100", branchId: 10 };
    const branchBAccount: ChartOfAccount = { ...ACCOUNTS[0], accountCode: "6200", branchId: 20 };
    const undimensionedAccount = ACCOUNTS[0]; // Bank — no branch/department/cost centre

    function withLines(accountCodes: string[]): Journal {
      return journal({
        id: 1,
        journalNumber: "JR000001",
        status: "Posted",
        lines: accountCodes.map((accountCode, i) => ({ id: i + 1, journalId: 1, accountCode, debit: 100, credit: 0, description: "", lineOrder: i })),
      });
    }

    it("matches with no filters set at all", () => {
      const accountsByCode = new Map([["6100", branchAAccount]].map(([k, v]) => [k as string, v as ChartOfAccount]));
      expect(journalMatchesDimensions(withLines(["6100"]), accountsByCode, { branchId: null, departmentId: null, costCentreId: null })).toBe(true);
    });

    it("matches when at least one line posts to an account in the filtered branch", () => {
      const accountsByCode = new Map<string, ChartOfAccount>([["6100", branchAAccount], ["1000", undimensionedAccount]]);
      expect(journalMatchesDimensions(withLines(["1000", "6100"]), accountsByCode, { branchId: 10, departmentId: null, costCentreId: null })).toBe(true);
    });

    it("does not match when no line posts to an account in the filtered branch", () => {
      const accountsByCode = new Map<string, ChartOfAccount>([["6200", branchBAccount]]);
      expect(journalMatchesDimensions(withLines(["6200"]), accountsByCode, { branchId: 10, departmentId: null, costCentreId: null })).toBe(false);
    });

    it("requires the same line's account to satisfy every set dimension filter simultaneously", () => {
      const combo: ChartOfAccount = { ...branchAAccount, accountCode: "6300", departmentId: 99 };
      const accountsByCode = new Map<string, ChartOfAccount>([["6300", combo]]);
      expect(journalMatchesDimensions(withLines(["6300"]), accountsByCode, { branchId: 10, departmentId: 99, costCentreId: null })).toBe(true);
      expect(journalMatchesDimensions(withLines(["6300"]), accountsByCode, { branchId: 10, departmentId: 100, costCentreId: null })).toBe(false);
    });
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(
      <JournalsTab
        companyId="co_1"
        journals={[
          journal({ id: 1, journalNumber: "JR000001", status: "Draft" }),
          journal({ id: 2, journalNumber: "JR000002", status: "Posted" }),
        ]}
        accounts={ACCOUNTS} branches={[]} departments={[]} costCentres={[]}
        previewMode={false}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
