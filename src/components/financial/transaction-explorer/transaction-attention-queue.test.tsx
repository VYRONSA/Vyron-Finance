import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { TransactionAttentionQueue } from "./transaction-attention-queue";
import type { BankTransactionRecord, TransactionDetail } from "@/server/accounting/types";
import type { BankingException } from "@/server/banking-rules/types";

function txn(overrides: Partial<BankTransactionRecord> & Pick<BankTransactionRecord, "id">): BankTransactionRecord {
  return {
    companyId: "co_1",
    transactionDate: "2026-07-01",
    reference: "",
    description: "",
    beneficiary: "",
    debit: 0,
    credit: 0,
    balance: null,
    bankAccount: "Main Trading Account",
    bankAccountId: 1,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "",
    sourceFilename: "",
    createdAt: "2026-07-01T00:00:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    postedFlag: false,
    postedAt: null,
    postingBatchId: null,
    sourceOccurrence: 1,
    reviewHold: false,
    reviewHoldReason: "",
    reviewHoldBy: null,
    reviewHoldAt: null,
    ...overrides,
  };
}

function detailFor(transaction: BankTransactionRecord): TransactionDetail {
  return {
    transaction,
    bankAccount: null,
    matchedSupplier: null,
    matchedCustomer: null,
    matchedMerchant: null,
    journal: null,
    matchHistory: [],
    allocationHistory: [],
    reviewHistory: [],
  };
}

const NEEDS_REVIEW = txn({ id: 1, description: "Suggested payment", beneficiary: "Fenwick Office Supplies", debit: 250, allocationStatus: "Suggested", reviewStatus: null });
const READY = txn({ id: 2, description: "Unallocated deposit", credit: 500, allocationStatus: "Unallocated" });
const DUPLICATE_EXCEPTION: BankingException = {
  id: 900,
  companyId: "co_1",
  bankTransactionId: 1,
  exceptionType: "PossibleDuplicate",
  reason: "Same amount and beneficiary within 3 days of another payment.",
  evidence: "",
  recommendedAction: "Confirm this isn't a repeat payment before allocating.",
  status: "Open",
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: "",
  createdAt: "2026-07-01T00:00:00Z",
};

describe("TransactionAttentionQueue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the real count of transactions needing attention", () => {
    render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[NEEDS_REVIEW, READY]} openExceptions={[]} />);
    // READY (plain Unallocated, no flags) is not an attention item — only NEEDS_REVIEW (Suggested, unreviewed) is.
    expect(screen.getByText("1 transaction needs your attention.")).toBeInTheDocument();
  });

  it("classifies a transaction with an open PossibleDuplicate exception into the duplicate group and labels its action accordingly", () => {
    render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[NEEDS_REVIEW]} openExceptions={[DUPLICATE_EXCEPTION]} />);
    expect(screen.getByRole("button", { name: "Review Possible Duplicate" })).toBeInTheDocument();
  });

  it("shows a positive empty state with real navigation links when nothing needs attention", () => {
    render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[READY]} openExceptions={[]} />);
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.getByText("VYRON has no transactions currently requiring review.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View All Transactions" })).toHaveAttribute("href", "#all-transactions");
    expect(screen.getByRole("link", { name: "Go to Banking" })).toHaveAttribute("href", "/company/co_1/bank-accounts");
    expect(screen.getByRole("link", { name: "Import Statement" })).toHaveAttribute("href", "/company/co_1/import-centre");
  });

  it("opens the real transaction detail panel and shows the passed-in exception when a queue row is reviewed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ detail: detailFor(NEEDS_REVIEW) }) }),
    );
    render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[NEEDS_REVIEW]} openExceptions={[DUPLICATE_EXCEPTION]} />);

    fireEvent.click(screen.getByRole("button", { name: "Review Possible Duplicate" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/companies/co_1/transactions/1");
    expect(screen.getByText(/Same amount and beneficiary within 3 days/)).toBeInTheDocument();
  });

  it("accepting a transaction calls the existing bulk review endpoint with the existing payload shape, then advances the queue", async () => {
    const secondNeedsReview = txn({ id: 5, description: "Second suggested payment", debit: 100, allocationStatus: "Suggested", reviewStatus: null });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/companies/co_1/transactions/bulk") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init!.body as string)).toEqual({ action: "review", transactionIds: [1], newStatus: "Approved", note: "" });
        return Promise.resolve({ ok: true, json: async () => ({ outcome: {} }) });
      }
      if (url === "/api/companies/co_1/transactions/1") {
        return Promise.resolve({ ok: true, json: async () => ({ detail: detailFor({ ...NEEDS_REVIEW, allocationStatus: "Allocated", reviewStatus: "Approved" }) }) });
      }
      if (url === "/api/companies/co_1/transactions/5") {
        return Promise.resolve({ ok: true, json: async () => ({ detail: detailFor(secondNeedsReview) }) });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[NEEDS_REVIEW, secondNeedsReview]} openExceptions={[]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Match Transaction" })[0]);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/transactions/bulk", expect.objectContaining({ method: "POST" })));
    // Advances to the next queue item's detail automatically instead of leaving the accountant stuck.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/transactions/5"));
  });

  it("Skip moves to the next attention item without calling any mutation endpoint", async () => {
    const secondNeedsReview = txn({ id: 5, description: "Second suggested payment", debit: 100, allocationStatus: "Suggested", reviewStatus: null });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/companies/co_1/transactions/1") return Promise.resolve({ ok: true, json: async () => ({ detail: detailFor(NEEDS_REVIEW) }) });
      if (url === "/api/companies/co_1/transactions/5") return Promise.resolve({ ok: true, json: async () => ({ detail: detailFor(secondNeedsReview) }) });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[NEEDS_REVIEW, secondNeedsReview]} openExceptions={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Match Transaction" })[0]);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Skip \/ Next/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/transactions/5"));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/companies/co_1/transactions/bulk", expect.anything());
  });

  it("has no obvious accessibility violations with a populated queue", async () => {
    const { container } = render(<TransactionAttentionQueue companyId="co_1" previewMode={false} initialItems={[NEEDS_REVIEW]} openExceptions={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
