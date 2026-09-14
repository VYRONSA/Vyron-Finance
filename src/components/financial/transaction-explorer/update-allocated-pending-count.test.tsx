/**
 * PRODUCTION DEFECT — "I can click Update Allocated, then it looks like it
 * updates, but then stays there. Allows you to update over and over again."
 *
 * Two independent causes, both reproduced here against the REAL
 * `<TransactionGrid>` (not a stand-in), driving its own inline cells:
 *
 *   1. The toolbar counted EVERY pending edit, including ones
 *      `computeCommitEligibility` refuses outright. Submitting one of those
 *      is a guaranteed no-op, so the row stayed in `pendingEdits` and the
 *      count never moved — click forever, nothing changes, no explanation.
 *   2. A run that saved nothing still rendered the green tick and
 *      "0 allocations updated successfully."
 *
 * WHY THIS FILE PATCHES THE DOM. jsdom reports every element as zero-sized,
 * so TanStack Virtual renders no rows at all and the grid's cells are
 * unreachable (which is why the sibling test files test extracted pure
 * functions instead). Giving the scroll container a real height is what
 * makes an end-to-end "edit rows, click Update, assert the count" test
 * possible — and that is the only kind of test that would have caught this.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import {
  TransactionGrid,
  blockedEditExplanation,
  triagePendingEdits,
  type BlockedPendingEdit,
  type PendingRowEdit,
  type TransactionGridHandle,
} from "./transaction-grid";
import { allocationUpdateSucceeded, pendingAllocationIds, summarizeAllocationUpdate } from "./transaction-explorer";
import type { BankTransactionRecord } from "@/server/accounting/types";

const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  for (const [prop, value] of [["clientHeight", 800], ["offsetHeight", 800], ["clientWidth", 1200], ["offsetWidth", 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 1200, height: 800, top: 0, left: 0, bottom: 800, right: 1200, x: 0, y: 0, toJSON() {} }) as DOMRect;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-03-05", reference: "", description: "Spend Money",
    beneficiary: "Capitec Bank", debit: 6, credit: 0, balance: null, bankAccount: "Metanoia", bankAccountId: 3,
    glAccount: "3030", vat: null, notes: "", importBatch: "XERO", sourceFilename: "bank.xlsx",
    createdAt: "2026-09-09T00:00:00Z", allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null,
    matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null,
    matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported",
    captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false,
    reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

/** An AI-suggested row: `getEdit` resolves it to a COMPLETE allocation, so
 * touching any cell produces a pending edit the grid will genuinely commit. */
function suggestedRow(id: number): BankTransactionRecord {
  return txn({ id, allocationType: "G", suggestedGlAccount: "3030", allocationStatus: "Suggested" });
}

type Reported = { count: number; committable: number; blocked: BlockedPendingEdit[] };

function Harness({
  rows: initialRows,
  onAllocate,
  reported,
}: {
  rows: BankTransactionRecord[];
  onAllocate: (t: BankTransactionRecord) => Promise<{ ok: true } | { ok: false; error: string }>;
  reported: Reported[];
}) {
  const ref = useRef<TransactionGridHandle>(null);
  const [rows, setRows] = useState(initialRows);
  const [committable, setCommittable] = useState<Set<number>>(new Set());
  const [blocked, setBlocked] = useState<BlockedPendingEdit[]>([]);
  // STABLE, exactly as the real parent does it (`useCallback(fn, [])` in
  // `transaction-explorer.tsx`). An inline arrow here would give the
  // callback a new identity on every render, re-firing the grid's effect,
  // which sets state again — the Phase 46 infinite render loop. Written
  // this way deliberately: the harness has to model the production
  // contract, not a shape production has already been fixed away from.
  const handlePendingEditsChange = useCallback(
    (count: number, _ids: Set<number>, triage: { committableIds: Set<number>; blocked: BlockedPendingEdit[] }) => {
      setCommittable(triage.committableIds);
      setBlocked(triage.blocked);
      reported.push({ count, committable: triage.committableIds.size, blocked: triage.blocked });
    },
    [reported],
  );
  return (
    <>
      {/* Mirrors the real toolbar: the count and the disabled state come
          from the COMMITTABLE ids, never from the raw pending-edit count. */}
      <button
        type="button"
        disabled={committable.size === 0}
        onClick={async () => {
          await ref.current?.saveSelected(pendingAllocationIds(committable));
        }}
      >
        {committable.size > 0 ? `Update Allocated (${committable.size})` : "Update Allocated"}
      </button>
      <button type="button" onClick={() => ref.current?.discardEdits(blocked.map((b) => b.id))}>
        Discard blocked
      </button>
      <TransactionGrid
        ref={ref}
        transactions={rows}
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
        chartOfAccounts={[{ accountCode: "3030", accountName: "Bank Charges", description: "Bank Charges", accountType: "Expense" } as never]}
        vatTreatments={[]}
        onPendingEditsChange={handlePendingEditsChange}
        onAllocateRow={async (t) => {
          const result = await onAllocate(t);
          if (result.ok) setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, allocationStatus: "Allocated" } : r)));
          return result;
        }}
        onBulkAllocate={async () => true}
        onCheckDuplicateRule={async () => null}
        onMerchantClick={() => {}}
        onSplitTransaction={() => {}}
      />
    </>
  );
}

function editNotes(index: number, value: string) {
  fireEvent.change(screen.getAllByLabelText("Allocation notes")[index], { target: { value } });
}

const latest = (reported: Reported[]) => reported[reported.length - 1];

describe("1. the reported defect: the pending count must reach zero after a successful bulk commit", () => {
  it("three committable edits, Update Allocated, then count 0 and the button back to its idle label", async () => {
    const reported: Reported[] = [];
    const onAllocate = vi.fn(async () => ({ ok: true as const }));
    render(<Harness rows={[suggestedRow(1), suggestedRow(2), suggestedRow(3)]} onAllocate={onAllocate} reported={reported} />);

    for (let i = 0; i < 3; i++) editNotes(i, `note-${i}`);
    await waitFor(() => expect(latest(reported).committable).toBe(3));
    expect(screen.getByRole("button", { name: "Update Allocated (3)" })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update Allocated (3)" }));
    });

    await waitFor(() => expect(latest(reported).count).toBe(0));
    expect(onAllocate).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Update Allocated" })).toBeDisabled();
  });

  it("a second click cannot re-commit what was already written", async () => {
    const reported: Reported[] = [];
    const onAllocate = vi.fn(async () => ({ ok: true as const }));
    render(<Harness rows={[suggestedRow(1), suggestedRow(2)]} onAllocate={onAllocate} reported={reported} />);

    for (let i = 0; i < 2; i++) editNotes(i, `note-${i}`);
    await waitFor(() => expect(latest(reported).committable).toBe(2));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update Allocated (2)" }));
    });
    await waitFor(() => expect(latest(reported).count).toBe(0));

    // The repeatable no-op click is gone: there is nothing left to submit.
    expect(screen.getByRole("button", { name: "Update Allocated" })).toBeDisabled();
    expect(onAllocate).toHaveBeenCalledTimes(2);
  });

  it("a row the server refuses stays pending and is not reported as saved", async () => {
    const reported: Reported[] = [];
    const onAllocate = vi.fn(async (t: BankTransactionRecord) =>
      t.id === 2
        ? { ok: false as const, error: "This transaction has already been posted to the general ledger and cannot be modified." }
        : { ok: true as const },
    );
    render(<Harness rows={[suggestedRow(1), suggestedRow(2)]} onAllocate={onAllocate} reported={reported} />);

    for (let i = 0; i < 2; i++) editNotes(i, `note-${i}`);
    await waitFor(() => expect(latest(reported).committable).toBe(2));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update Allocated (2)" }));
    });

    // The refused row keeps the accountant's work — never silently dropped.
    await waitFor(() => expect(latest(reported).count).toBe(1));
    expect(latest(reported).committable).toBe(1);
  });
});

describe("2. edits the grid will never commit are not counted as pending work", () => {
  it("notes-only on an unallocated row is reported as blocked, not as committable", async () => {
    const reported: Reported[] = [];
    render(<Harness rows={[txn({ id: 1 }), txn({ id: 2 }), txn({ id: 3 })]} onAllocate={async () => ({ ok: true })} reported={reported} />);

    for (let i = 0; i < 3; i++) editNotes(i, `note-${i}`);

    await waitFor(() => expect(latest(reported).blocked).toHaveLength(3));
    expect(latest(reported).count).toBe(3);
    expect(latest(reported).committable).toBe(0);
    // The button cannot be clicked at all, so it cannot appear to work.
    expect(screen.getByRole("button", { name: "Update Allocated" })).toBeDisabled();
  });

  it("blocked edits can be discarded, so the pending count can always reach zero", async () => {
    const reported: Reported[] = [];
    render(<Harness rows={[txn({ id: 1 }), txn({ id: 2 })]} onAllocate={async () => ({ ok: true })} reported={reported} />);

    for (let i = 0; i < 2; i++) editNotes(i, `note-${i}`);
    await waitFor(() => expect(latest(reported).blocked).toHaveLength(2));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard blocked" }));
    });
    await waitFor(() => expect(latest(reported).count).toBe(0));
    expect(latest(reported).blocked).toHaveLength(0);
  });

  it("a mixed page commits the committable rows and leaves the blocked ones stated", async () => {
    const reported: Reported[] = [];
    const onAllocate = vi.fn(async () => ({ ok: true as const }));
    render(<Harness rows={[suggestedRow(1), txn({ id: 2 })]} onAllocate={onAllocate} reported={reported} />);

    editNotes(0, "committable");
    editNotes(1, "blocked");
    await waitFor(() => expect(latest(reported).committable).toBe(1));
    expect(latest(reported).blocked).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update Allocated (1)" }));
    });
    await waitFor(() => expect(latest(reported).committable).toBe(0));
    expect(onAllocate).toHaveBeenCalledTimes(1);
    expect(latest(reported).blocked).toHaveLength(1);
    expect(latest(reported).count).toBe(1);
  });
});

describe("3. triagePendingEdits — the pure split", () => {
  function edit(overrides: Partial<PendingRowEdit> = {}): PendingRowEdit {
    return {
      type: "G", accountCode: "3030", supplierId: null, customerId: null, vatCode: "",
      allocationNotes: "", description: "Spend Money", overrideSupplierInvoiceMatching: false, setRule: false,
      ...overrides,
    };
  }

  it("a complete allocation is committable", () => {
    const triage = triagePendingEdits(new Map([[1, edit()]]), [txn({ id: 1 })]);
    expect([...triage.committableIds]).toEqual([1]);
    expect(triage.blocked).toEqual([]);
  });

  it("a Type with no account chosen is blocked, with the incomplete-allocation reason", () => {
    const triage = triagePendingEdits(new Map([[1, edit({ accountCode: "" })]]), [txn({ id: 1 })]);
    expect(triage.committableIds.size).toBe(0);
    expect(triage.blocked).toEqual([{ id: 1, reason: "Missing account, supplier, or customer" }]);
  });

  it("notes-only on an unallocated row is blocked", () => {
    const triage = triagePendingEdits(new Map([[1, edit({ type: null, accountCode: "", allocationNotes: "x" })]]), [txn({ id: 1 })]);
    expect(triage.blocked).toEqual([{ id: 1, reason: "No changes to save" }]);
  });

  it("a changed description alone is committable, even with no allocation", () => {
    const triage = triagePendingEdits(new Map([[1, edit({ type: null, accountCode: "", description: "Corrected narration" })]]), [txn({ id: 1 })]);
    expect([...triage.committableIds]).toEqual([1]);
  });

  it("an edit whose row has left the page counts as neither — prunePendingEdits owns it", () => {
    const triage = triagePendingEdits(new Map([[99, edit()]]), [txn({ id: 1 })]);
    expect(triage.committableIds.size).toBe(0);
    expect(triage.blocked).toEqual([]);
  });

  it("no pending edits means nothing committable and nothing blocked", () => {
    const triage = triagePendingEdits(new Map(), [txn({ id: 1 })]);
    expect(triage.committableIds.size).toBe(0);
    expect(triage.blocked).toEqual([]);
  });

  it("the accountant-facing explanations say what is actually required", () => {
    expect(blockedEditExplanation("No changes to save")).toMatch(/choose a Type and account, or change the Description/i);
    expect(blockedEditExplanation("Missing account, supplier, or customer")).toMatch(/allocation is incomplete/i);
    // Anything else (a server refusal) is passed through verbatim.
    expect(blockedEditExplanation("Held for human review")).toBe("Held for human review");
  });
});

describe("4. a run that saved nothing never reads as a success", () => {
  it("zero saved with nothing to save is stated plainly", () => {
    expect(summarizeAllocationUpdate({ saved: 0, unchanged: 0, failed: [] })).toBe("Nothing was updated — there were no changes to save.");
    expect(allocationUpdateSucceeded({ saved: 0, unchanged: 0, failed: [] })).toBe(false);
  });

  it("zero saved because every row was already up to date says so, and is not a tick", () => {
    expect(summarizeAllocationUpdate({ saved: 0, unchanged: 3, failed: [] })).toBe("Nothing was updated — 3 transactions were already up to date.");
    expect(summarizeAllocationUpdate({ saved: 0, unchanged: 1, failed: [] })).toBe("Nothing was updated — 1 transaction was already up to date.");
    expect(allocationUpdateSucceeded({ saved: 0, unchanged: 3, failed: [] })).toBe(false);
  });

  it("a real save still reads as a success", () => {
    expect(summarizeAllocationUpdate({ saved: 3, unchanged: 0, failed: [] })).toBe("3 allocations updated successfully.");
    expect(allocationUpdateSucceeded({ saved: 3, unchanged: 0, failed: [] })).toBe(true);
  });

  it("a partial failure is never a success", () => {
    const summary = { saved: 2, unchanged: 0, failed: [{ id: 9, reason: "posted" }] };
    expect(summarizeAllocationUpdate(summary)).toBe("2 updated · 1 failed");
    expect(allocationUpdateSucceeded(summary)).toBe(false);
  });
});
