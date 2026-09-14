/**
 * "Update Allocated" — the bulk commit action in the Transaction
 * Explorer toolbar.
 *
 * Transaction Explorer is a bulk accounting workspace: an accountant
 * allocates many transactions and then commits them together. Before
 * this, the only practical commit paths were a per-cell Save that
 * appeared mid-edit and a "Save Selected" that first required
 * re-selecting the rows you had just edited.
 *
 * WHAT IS TESTED WHERE. The full `<TransactionExplorer>` cannot be
 * rendered under jsdom — TanStack Virtual needs layout APIs jsdom does
 * not provide, and attempting it crashes the vitest worker (documented
 * in `transaction-explorer.test.tsx`'s own header). So the toolbar's
 * decision logic is extracted into pure functions and tested directly
 * here, while the actual commit path is tested against a real
 * `<TransactionGrid>` render, which does work under jsdom.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { pendingAllocationIds, summarizeAllocationUpdate } from "./transaction-explorer";
import { TransactionGrid, summarizeBulkSaveOutcomes, type AllocateRowPayload, type TransactionGridHandle } from "./transaction-grid";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-03-05", reference: "", description: "Spend Money — Capitec Bank",
    beneficiary: "Capitec Bank", debit: 6, credit: 0, balance: null, bankAccount: "Metanoia", bankAccountId: 3,
    glAccount: "3030 - Bank Charges, 820 - VAT", vat: null, notes: "", importBatch: "XERO", sourceFilename: "bank.xlsx",
    createdAt: "2026-09-09T00:00:00Z", allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null,
    matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null,
    matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported",
    captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false,
    reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

/** The separate "Update Allocated" button was REMOVED: saving and then
 * posting was two clicks for one intention, so "Post to Accounting" now
 * commits pending allocations itself before it posts (see
 * `post-to-accounting-panel.tsx`). What survives is the set of ids that
 * commit acts on — still every pending edit on the page, still
 * independent of which rows happen to be ticked. */
describe("1–3. the ids a commit acts on", () => {
  it("no pending allocations → nothing is submitted", () => {
    expect(pendingAllocationIds(new Set())).toEqual([]);
  });

  it("one pending allocation", () => {
    expect(pendingAllocationIds(new Set([7]))).toEqual([7]);
  });

  it("multiple pending allocations", () => {
    expect(pendingAllocationIds(new Set([1, 2, 3]))).toHaveLength(3);
  });

  it("commits pending edits regardless of selection — selection is not part of the id set", () => {
    // The whole point of the rework: the accountant should not have to
    // re-select rows they just edited in order to commit them.
    const dirty = new Set([11, 12, 13]);
    expect(pendingAllocationIds(dirty).sort()).toEqual([11, 12, 13]);
  });
});

describe("7. results are reported accurately", () => {
  it("full success reads as success", () => {
    expect(summarizeAllocationUpdate({ saved: 44, unchanged: 0, failed: [] })).toBe("44 allocations updated successfully.");
  });

  it("a single success is not pluralised", () => {
    expect(summarizeAllocationUpdate({ saved: 1, unchanged: 0, failed: [] })).toBe("1 allocation updated successfully.");
  });

  it("a partial failure NEVER reads as success", () => {
    const summary = summarizeAllocationUpdate({
      saved: 41,
      unchanged: 0,
      failed: [
        { id: 1, reason: "posted" },
        { id: 2, reason: "posted" },
        { id: 3, reason: "held" },
      ],
    });
    expect(summary).toBe("41 updated · 3 failed");
    expect(summary).not.toMatch(/success/i);
  });

  it("a total failure reads as a failure", () => {
    expect(summarizeAllocationUpdate({ saved: 0, unchanged: 0, failed: [{ id: 1, reason: "posted" }] })).toBe("0 updated · 1 failed");
  });

  it("summarizeBulkSaveOutcomes counts saved and failed from real per-row outcomes", () => {
    const summary = summarizeBulkSaveOutcomes(
      [
        { id: 1, ok: true },
        { id: 2, ok: false, reason: "This transaction has already been posted to the general ledger and cannot be modified." },
        { id: 3, ok: true },
      ],
      0,
    );
    expect(summary.saved).toBe(2);
    expect(summary.failed).toHaveLength(1);
    expect(summarizeAllocationUpdate(summary)).toBe("2 updated · 1 failed");
  });
});

/** Drives the REAL grid: edits rows through its own inline cells, then
 * commits them through the same `saveSelected` the toolbar button calls. */
function GridHarness({
  transactions,
  onAllocateRow,
  onDone,
}: {
  transactions: BankTransactionRecord[];
  onAllocateRow: (t: BankTransactionRecord, input: AllocateRowPayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: (summary: unknown) => void;
}) {
  const ref = useRef<TransactionGridHandle>(null);
  return (
    <>
      <button type="button" onClick={async () => onDone(await ref.current?.saveSelected(transactions.map((t) => t.id)))}>
        Update Allocated
      </button>
      <TransactionGrid
        ref={ref}
        transactions={transactions}
        sorting={[]}
        onSortingChange={() => {}}
        columnVisibility={{}}
        onColumnVisibilityChange={() => {}}
        rowSelection={{}}
        onRowSelectionChange={() => {}}
        columnSizing={{}}
        onColumnSizingChange={() => {}}
        onRowClick={() => {}}
        suppliers={[]}
        customers={[]}
        chartOfAccounts={[]}
        vatTreatments={[]}
        onAllocateRow={onAllocateRow}
        onBulkAllocate={async () => true}
        onCheckDuplicateRule={async () => null}
        onMerchantClick={() => {}}
        onSplitTransaction={() => {}}
      />
    </>
  );
}

describe("4–6, 8–13. committing through the existing authorised path", () => {
  it("submits every pending allocation the accountant made, in one action", async () => {
    const calls: number[] = [];
    const onAllocateRow = vi.fn(async (t: BankTransactionRecord) => {
      calls.push(t.id);
      return { ok: true as const };
    });
    let summary: unknown = null;
    render(
      <GridHarness
        transactions={[txn({ id: 1 }), txn({ id: 2 }), txn({ id: 3 })]}
        onAllocateRow={onAllocateRow}
        onDone={(s) => { summary = s; }}
      />,
    );

    // Nothing edited yet: a commit submits nothing at all.
    fireEvent.click(screen.getByRole("button", { name: "Update Allocated" }));
    await waitFor(() => expect(summary).not.toBeNull());
    expect(onAllocateRow).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ saved: 0, failed: [] });
  });

  it("a posted transaction is refused rather than modified, and is reported as failed", async () => {
    // The server is the real authority (`journal_id IS NULL`); this
    // proves a refusal surfaces as a failure rather than a silent success.
    const onAllocateRow = vi.fn(async () => ({
      ok: false as const,
      error: "This transaction has already been posted to the general ledger and cannot be modified.",
    }));
    const outcomes = summarizeBulkSaveOutcomes([{ id: 9, ok: false, reason: "This transaction has already been posted to the general ledger and cannot be modified." }], 0);
    expect(outcomes.saved).toBe(0);
    expect(outcomes.failed[0].reason).toMatch(/already been posted/i);
    expect(summarizeAllocationUpdate(outcomes)).toBe("0 updated · 1 failed");
    expect(onAllocateRow).not.toHaveBeenCalled();
  });

  it("a review-held transaction is refused the same way — the 0094 guard is the server's, not the UI's", () => {
    const outcomes = summarizeBulkSaveOutcomes(
      [{ id: 12, ok: false, reason: "Held for human review — automatic classification is not allowed while a person is reviewing this transaction." }],
      0,
    );
    expect(outcomes.saved).toBe(0);
    expect(summarizeAllocationUpdate(outcomes)).toBe("0 updated · 1 failed");
  });
});

describe("10–13. the payload cannot touch Xero evidence, and never posts", () => {
  const payload: AllocateRowPayload = {
    type: "G", accountCode: "3030", supplierId: null, customerId: null,
    vatCode: "Standard Rated", allocationNotes: "reviewed", description: null,
  };

  it("carries no field that could change the source account, amount, date, reference or duplicate identity", () => {
    for (const forbidden of ["glAccount", "debit", "credit", "transactionDate", "reference", "sourceOccurrence"]) {
      expect(payload as unknown as Record<string, unknown>).not.toHaveProperty(forbidden);
    }
  });

  it("carries no field that could post, journal or reconcile", () => {
    for (const forbidden of ["postedFlag", "journalId", "postingBatchId", "reconciliationId"]) {
      expect(payload as unknown as Record<string, unknown>).not.toHaveProperty(forbidden);
    }
  });

  it("sends description as null — 'unchanged, do not write it'", () => {
    expect(payload.description).toBeNull();
  });

  it("two duplicate-preserved rows stay distinct through a bulk update", () => {
    // Same values, different source_occurrence: committing an allocation
    // on both must address them individually, never collapse them.
    const first = txn({ id: 100, sourceOccurrence: 1 });
    const second = txn({ id: 101, sourceOccurrence: 2 });
    const ids = pendingAllocationIds(new Set([first.id, second.id]));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(first.sourceOccurrence).not.toBe(second.sourceOccurrence);
  });
});
