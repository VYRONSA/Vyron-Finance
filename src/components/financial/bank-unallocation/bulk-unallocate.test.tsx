import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkUnallocate } from "./bulk-unallocate";
import type { UnallocationCandidate, UnallocationResult } from "@/server/banking/bulk-unallocation";

function candidate(id: number, overrides: Partial<UnallocationCandidate> = {}): UnallocationCandidate {
  return {
    id, transactionDate: "2026-03-01", description: `Txn ${id}`, reference: `REF-${id}`, amount: -100, bankAccountId: 1,
    bankAccountName: "Cheque", allocationStatus: "Allocated", allocationMethod: "Manual", glAccountCode: "6100",
    glAccountName: "Bank Charges", exclusionReason: null, ...overrides,
  };
}

const CANDIDATES = [
  candidate(1, { transactionDate: "2026-03-01", amount: -100.25 }),
  candidate(2, { transactionDate: "2026-03-31", amount: 50, glAccountCode: "6200", glAccountName: "Motor Vehicle" }),
  candidate(3, { description: "Posted one", exclusionReason: "Posted to the general ledger. Reverse the posting first." }),
];

const fetchMock = vi.fn();

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function renderScreen(props: Partial<Parameters<typeof BulkUnallocate>[0]> = {}) {
  return render(<BulkUnallocate companyId="co_1" bankAccounts={[{ id: 1, accountName: "Cheque" }]} canEdit previewMode={false} {...props} />);
}

function setRange(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("From Date"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("To Date"), { target: { value: to } });
}

async function previewWith(candidates: UnallocationCandidate[]) {
  fetchMock.mockImplementationOnce(() =>
    respond({ preview: { dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null, candidates, truncated: false } }),
  );
  setRange("2026-03-01", "2026-03-31");
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("button", { name: "Select all eligible" });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("BulkUnallocate", () => {
  it("refuses a From Date later than the To Date and never asks the server", () => {
    renderScreen();
    setRange("2026-03-31", "2026-03-01");
    expect(screen.getByText("From Date cannot be later than To Date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("previews the range and shows date, description, reference, amount, GL code and name and status", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/companies/co_1/transactions/bulk-unallocate/preview");
    expect(body).toEqual({ dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null });
    expect(screen.getByText("2 eligible transactions · 1 excluded")).toBeInTheDocument();
    expect(screen.getByText("6200 — Motor Vehicle")).toBeInTheDocument();
    expect(screen.getByText("REF-1")).toBeInTheDocument();
    expect(screen.getByText("-100.25")).toBeInTheDocument();
  });

  it("explains each exclusion and does not let an excluded transaction be selected", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    expect(screen.getByText("Excluded: Posted to the general ledger. Reverse the posting first.")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Posted one")).toBeDisabled();
  });

  it("selects all eligible — only eligible — and shows the count and total value before anything happens", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    expect(screen.getByText(/Selected: 0 transactions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible" }));
    expect(screen.getByText("Selected: 2 transactions · total value R-50.25")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Posted one")).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for explicit confirmation, then sends exactly the selected rows, their previewed GL and the preview's key", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    fireEvent.click(screen.getByLabelText("Select Txn 2"));
    fireEvent.click(screen.getByRole("button", { name: "Unallocate selected" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result: UnallocationResult = {
      runId: 12, requested: 1, unallocated: 1, skipped: 0, failed: 0,
      items: [{ transactionId: 2, outcome: "unallocated", reason: "", glAccount: "6200", glAccountName: "Motor Vehicle" }],
    };
    fetchMock.mockImplementationOnce(() => respond({ result }));
    fireEvent.click(screen.getByRole("button", { name: "Unallocate 1 transaction" }));

    await screen.findByText("1 transaction processed · 1 unallocated · 0 skipped · 0 failed");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/companies/co_1/transactions/bulk-unallocate/execute");
    const sent = JSON.parse(init.body);
    expect(sent.items).toEqual([{ id: 2, glAccount: "6200" }]);
    expect(sent).toMatchObject({ dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null });
    expect(sent.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText("Audit reference: run #12.")).toBeInTheDocument();
  });

  it("reports skipped and failed transactions with their reasons — never as unallocated", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    fireEvent.click(screen.getByRole("button", { name: "Select all eligible" }));
    fireEvent.click(screen.getByRole("button", { name: "Unallocate selected" }));
    fetchMock.mockImplementationOnce(() =>
      respond({
        result: {
          runId: 13, requested: 2, unallocated: 0, skipped: 1, failed: 1,
          items: [
            { transactionId: 1, outcome: "skipped", reason: "Changed since the preview (GL account is now 6300). Preview again.", glAccount: "6300", glAccountName: null },
            { transactionId: 2, outcome: "failed", reason: "could not obtain lock", glAccount: "6200", glAccountName: null },
          ],
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unallocate 2 transactions" }));
    await screen.findByText("2 transactions processed · 0 unallocated · 1 skipped · 1 failed");
    expect(screen.getByText(/Changed since the preview/)).toBeInTheDocument();
    expect(screen.getByText(/could not obtain lock/)).toBeInTheDocument();
    expect(screen.queryByText(/keeps its previous GL account/)).not.toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the preview when nothing was executed", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    fireEvent.click(screen.getByLabelText("Select Txn 1"));
    fireEvent.click(screen.getByRole("button", { name: "Unallocate selected" }));
    fetchMock.mockImplementationOnce(() => respond({ error: "This preview has already been executed." }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Unallocate 1 transaction" }));
    await screen.findByText("This preview has already been executed.");
    expect(screen.queryByText(/processed ·/)).not.toBeInTheDocument();
  });

  it("discards the preview when the range changes, so a selection is never executed against other criteria", async () => {
    renderScreen();
    await previewWith(CANDIDATES);
    fireEvent.change(screen.getByLabelText("To Date"), { target: { value: "2026-03-30" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Select all eligible" })).not.toBeInTheDocument());
  });

  it("a user without Banking:Edit cannot preview or execute", () => {
    renderScreen({ canEdit: false });
    setRange("2026-03-01", "2026-03-31");
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(screen.getByText(/needs the Banking Edit permission/)).toBeInTheDocument();
  });
});
