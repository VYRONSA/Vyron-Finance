/**
 * Bulk Unpost (migration 0120) on the existing Bulk Unallocate screen:
 * Transactions = Posted -> preview -> select (whole journals) -> confirm ->
 * per-transaction result with the reversal references.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkUnallocate } from "./bulk-unallocate";
import type { UnpostingCandidate, UnpostingResult } from "@/server/banking/bulk-unallocation";

function candidate(id: number, journalId: number, overrides: Partial<UnpostingCandidate> = {}): UnpostingCandidate {
  return {
    id, transactionDate: "2026-03-10", description: `Txn ${id}`, reference: `REF-${id}`, amount: -100, bankAccountId: 1, bankAccountName: "Cheque",
    allocationStatus: "Allocated", allocationType: "G", glAccountCode: "6100", glAccountName: "Bank Charges",
    customerId: null, customerCode: null, customerName: null, supplierId: null, supplierCode: null, supplierName: null,
    journalId, journalNumber: `JR0000${journalId}`, journalDate: "2026-03-10", journalSourceType: "bank_transactions_post",
    journalTransactionCount: 1, exclusionReason: null, ...overrides,
  };
}

const CANDIDATES = [
  candidate(1, 10, { journalTransactionCount: 2, amount: -115 }),
  candidate(2, 10, { journalTransactionCount: 2, amount: 200, allocationType: "C", glAccountCode: null, customerId: 7, customerCode: "CUST-001", customerName: "Acme" }),
  candidate(3, 20, { transactionDate: "2026-03-31", amount: -104, journalSourceType: "bank_transaction_rule_engine" }),
  candidate(4, 30, { description: "Reconciled one", exclusionReason: "Included in a bank reconciliation. A reconciled transaction is never unposted here." }),
];

const fetchMock = vi.fn();

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function renderScreen(props: Partial<Parameters<typeof BulkUnallocate>[0]> = {}) {
  return render(<BulkUnallocate companyId="co_1" bankAccounts={[{ id: 1, accountName: "Cheque" }]} canEdit canReverse previewMode={false} {...props} />);
}

async function previewPosted(candidates = CANDIDATES) {
  fetchMock.mockImplementationOnce(() =>
    respond({ preview: { dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null, candidates, truncated: false } }),
  );
  fireEvent.change(screen.getByLabelText("Transactions"), { target: { value: "posted" } });
  fireEvent.change(screen.getByLabelText("From Date"), { target: { value: "2026-03-01" } });
  fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-03-31" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByText(/eligible posted transactions/);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("BulkUnallocate — posted transactions", () => {
  it("previews from the posted endpoint and shows what is kept, the journal and every exclusion reason", async () => {
    renderScreen();
    await previewPosted();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/companies/co_1/transactions/bulk-unallocate/posted/preview");
    expect(screen.getByText("3 eligible posted transactions · 1 excluded")).toBeInTheDocument();
    expect(screen.getByText("Customer CUST-001 — Acme")).toBeInTheDocument();
    expect(screen.getAllByText("6100 — Bank Charges").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Post to Accounting · 2 transactions together/)).toHaveLength(2);
    expect(screen.getByText(/Excluded: Included in a bank reconciliation/)).toBeInTheDocument();
    expect(screen.getByLabelText("Select Reconciled one")).toBeDisabled();
  });

  it("selecting one transaction selects its whole journal; Clear and Select all work", async () => {
    renderScreen();
    await previewPosted();
    fireEvent.click(screen.getByLabelText("Select Txn 2"));
    expect(screen.getByLabelText("Select Txn 1")).toBeChecked();
    expect(screen.getByText("Selected: 2 transactions on 1 journal · total value R85.00")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Txn 1"));
    expect(screen.getByLabelText("Select Txn 2")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible" }));
    expect(screen.getByText("Selected: 3 transactions on 2 journals · total value R-19.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Reconciled one")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText(/Selected: 0 transactions/)).toBeInTheDocument();
  });

  it("confirms explicitly, sends the previewed picture of each transaction, and reports the reversals", async () => {
    renderScreen();
    await previewPosted();
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpost and unallocate selected" }));
    expect(screen.getByText(/Reverse 2 journals and unpost 3 transactions totalling R-19.00/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result: UnpostingResult = {
      runId: 31, requested: 3, unposted: 2, skipped: 0, failed: 1, reversedJournals: 1, postingBatchId: 5,
      items: [
        { transactionId: 1, outcome: "unposted", reason: "", glAccount: "6100", glAccountName: "Bank Charges", customerCode: null, supplierCode: null, journalNumber: "JR000010", reversalJournalNumber: "JR000050" },
        { transactionId: 2, outcome: "unposted", reason: "", glAccount: null, glAccountName: null, customerCode: "CUST-001", supplierCode: null, journalNumber: "JR000010", reversalJournalNumber: "JR000050" },
        { transactionId: 3, outcome: "failed", reason: "could not obtain lock", glAccount: "6100", glAccountName: null, customerCode: null, supplierCode: null, journalNumber: "JR000020", reversalJournalNumber: null },
      ],
    };
    fetchMock.mockImplementationOnce(() => respond({ result }));
    fireEvent.click(screen.getByRole("button", { name: "Unpost 3 transactions" }));
    await screen.findByText("3 transactions processed · 2 unposted (1 journal reversed) · 0 skipped · 1 failed");

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/companies/co_1/transactions/bulk-unallocate/posted/execute");
    const body = JSON.parse(init.body);
    expect(body.items).toEqual([
      { id: 1, journalId: 10, glAccount: "6100", customerId: null, supplierId: null },
      { id: 2, journalId: 10, glAccount: "", customerId: 7, supplierId: null },
      { id: 3, journalId: 20, glAccount: "6100", customerId: null, supplierId: null },
    ]);
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText("JR000010 reversed by JR000050")).toBeInTheDocument();
    expect(screen.getByText(/could not obtain lock/)).toBeInTheDocument();
    expect(screen.getByText("Audit reference: run #31.")).toBeInTheDocument();
    // The preview is spent: a second execution needs a new preview.
    expect(screen.queryByRole("button", { name: "Unpost and unallocate selected" })).not.toBeInTheDocument();
  });

  it("shows a refused (repeated) run as an error, not a result", async () => {
    renderScreen();
    await previewPosted();
    fireEvent.click(screen.getByLabelText("Select Txn 3"));
    fireEvent.click(screen.getByRole("button", { name: "Unpost and unallocate selected" }));
    fetchMock.mockImplementationOnce(() => respond({ error: "This preview has already been executed." }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Unpost 1 transaction" }));
    await screen.findByText("This preview has already been executed.");
    expect(screen.queryByText(/processed ·/)).not.toBeInTheDocument();
  });

  it("changing the criteria discards the preview", async () => {
    renderScreen();
    await previewPosted();
    fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-03-30" } });
    await waitFor(() => expect(screen.queryByText(/eligible posted transactions/)).not.toBeInTheDocument());
  });

  it("without General Ledger Reverse the posted preview cannot be run, and says why", () => {
    renderScreen({ canReverse: false });
    fireEvent.change(screen.getByLabelText("Transactions"), { target: { value: "posted" } });
    fireEvent.change(screen.getByLabelText("From Date"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-03-31" } });
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(screen.getByText(/also needs the General Ledger Reverse permission/)).toBeInTheDocument();
  });

  it("leaves the unposted (0119) flow as it was by default", () => {
    renderScreen();
    expect(screen.getByLabelText("Transactions")).toHaveValue("allocated");
  });
});
