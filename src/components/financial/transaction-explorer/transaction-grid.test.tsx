import { useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { TransactionBulkActionBar } from "./transaction-bulk-action-bar";
import {
  TransactionGrid,
  prunePendingEdits,
  computeMatchStatus,
  initialEdit,
  needsAiAcceptAction,
  rulePreviewText,
  ruleOptionsForCommit,
  isAllocationMissing,
  selectDirtyIds,
  summarizeBulkSaveOutcomes,
  runWithConcurrencyLimit,
  computeDescriptionUpdate,
  computeCommitEligibility,
  buildAccountCodeOptions,
  ruleTypeFor,
  ruleActionsFor,
  accountTypeLabelFor,
  ALL_COLUMN_IDS,
  COLUMN_LABELS,
  type BulkSaveOutcome,
  type AllocateRowPayload,
} from "./transaction-grid";
import type { RuleCreationOptions } from "./transaction-bulk-action-bar";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";

function supplier(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "c1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

function txn(id: number): BankTransactionRecord {
  return {
    id, companyId: "c1", transactionDate: "2026-08-01", reference: `REF-${id}`, description: `Transaction ${id}`,
    beneficiary: `Merchant ${id % 10}`, debit: 100, credit: 0, balance: null, bankAccount: "", bankAccountId: 1,
    glAccount: "", vat: null, notes: "", importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "",
    isManualOverride: false, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null,
    allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null,
    cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
  };
}

const TRANSACTIONS = Array.from({ length: 300 }, (_, i) => txn(i + 1));

// Phase 42 — file-wide, not scoped to one describe block: jsdom runs no
// layout engine, so `offsetHeight`/`offsetWidth` (a getter-only accessor
// property) are permanently 0 for every element. `@tanstack/virtual-core`'s
// own `getRect()` reads exactly these two properties (confirmed by
// reading its source, NOT `getBoundingClientRect`) for its very first,
// synchronous container measurement — so without this, EVERY test in
// this file that renders `TransactionGrid` sees a 0-height viewport and
// mounts ZERO rows, including the pre-existing "renders without
// crashing" test below, which had been silently passing on that empty
// result (its own assertion, `toBeLessThan(TRANSACTIONS.length)`, is
// true even at zero). A real browser's viewport is never zero-height,
// so this restores the condition the real production page actually runs
// under, rather than leaving virtualization untestable file-wide.
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1200 });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  globalThis.ResizeObserver = originalResizeObserver;
});

// Phase 40, Live Defect 1 — production screenshot: a Supplier rule's
// confirmation dialog displayed "GL Account — Three Streams FISH"
// instead of "Supplier — Three Streams FISH". These prove the ACTUAL
// stored action (never traced by a UI test alone) is genuinely
// `set_supplier`, never `set_gl_account`, for a Supplier Type — and that
// the display label helper agrees.
describe("ruleActionsFor / ruleTypeFor — Supplier action never becomes a GL action (Phase 40, Live Defect 1)", () => {
  const supplierPayload = { type: "S" as const, accountCode: null, supplierId: 42, customerId: null, vatCode: null, allocationNotes: "", description: null };
  const glPayload = { type: "G" as const, accountCode: "6100", supplierId: null, customerId: null, vatCode: null, allocationNotes: "", description: null };
  const customerPayload = { type: "C" as const, accountCode: null, supplierId: null, customerId: 7, vatCode: null, allocationNotes: "", description: null };

  it("a Supplier Type stores a set_supplier action with the supplier's own id as targetId — never set_gl_account", () => {
    const actions = ruleActionsFor(supplierPayload);
    expect(actions[0]).toEqual({ actionType: "set_supplier", targetId: 42 });
    expect(actions[0].actionType).not.toBe("set_gl_account");
    expect(ruleTypeFor("S")).toBe("Supplier");
  });

  it("a GL Type stores a set_gl_account action with the account code as targetText", () => {
    const actions = ruleActionsFor(glPayload);
    expect(actions[0]).toEqual({ actionType: "set_gl_account", targetText: "6100" });
    expect(ruleTypeFor("G")).toBe("GL");
  });

  it("a Customer Type stores a set_customer action with the customer's own id as targetId", () => {
    const actions = ruleActionsFor(customerPayload);
    expect(actions[0]).toEqual({ actionType: "set_customer", targetId: 7 });
    expect(ruleTypeFor("C")).toBe("Customer");
  });

  it("accountTypeLabelFor labels each Type distinctly — the exact fix for the mislabeled dialog", () => {
    expect(accountTypeLabelFor("S")).toBe("Supplier");
    expect(accountTypeLabelFor("C")).toBe("Customer");
    expect(accountTypeLabelFor("G")).toBe("GL Account");
    expect(accountTypeLabelFor(null)).toBe("GL Account");
  });
});

// Phase 22A — AI Transaction Classification's badge addition. Confirms
// the new "AI Classified" state is visually distinct AND still respects
// the existing precedence chain (a rule/needs-review/duplicate/invalid
// signal must still win — AI never runs on a transaction any of those
// already touched, but this proves the display logic doesn't rely on
// that invariant alone).
// Phase 26J — Production Forensic Investigation. Root cause of "real AI
// allocations exist in the database but Transaction Explorer shows them
// as blank": `allocationType` was never set by `fn_apply_ai_classification`
// (or by Banking Rules'/`bulkAssignGl`'s older write paths), so the row's
// displayed Type — which the Account Code cell's visible value is
// entirely gated on — resolved to null despite a real, correct
// `suggestedGlAccount` sitting on the row. `initialEdit` now falls back
// to inferring Type "G" from `suggestedGlAccount` itself.
describe("initialEdit — Type inference fallback (Phase 26J)", () => {
  it("infers Type G from a real suggestedGlAccount when allocationType was never set — the exact production defect", () => {
    const t = txn(1);
    t.allocationType = null;
    t.suggestedGlAccount = "6940";
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Future AI";

    const edit = initialEdit(t);

    expect(edit.type).toBe("G");
    expect(edit.accountCode).toBe("6940");
  });

  it("still prefers an explicit allocationType when one is present", () => {
    const t = txn(1);
    t.allocationType = "C";
    t.suggestedGlAccount = "6940";
    t.matchedCustomerId = 42;

    expect(initialEdit(t).type).toBe("C");
  });

  it("still prefers a matched supplier/customer over a stray suggestedGlAccount", () => {
    const t = txn(1);
    t.allocationType = null;
    t.matchedSupplierId = 7;
    t.suggestedGlAccount = "6940";

    expect(initialEdit(t).type).toBe("S");
  });

  it("resolves to null Type for a genuinely untouched transaction (no regression for the ordinary case)", () => {
    const t = txn(1);
    expect(initialEdit(t).type).toBeNull();
  });
});

// Phase 31 — migrated from the now-deleted `transaction-grid.test.ts`.
// That file predated this one (renamed to `.tsx` once row-rendering
// tests were added) and was never removed — it silently shadowed this
// file in `tsc`'s file inclusion the whole time (two files sharing a
// base name differing only by `.ts`/`.tsx`), meaning EVERY tsc gate run
// against this codebase since it was created had never actually
// type-checked this file. These 9 non-AI precedence-chain tests are the
// only coverage that file had that isn't already re-proven (layered with
// AI-specific variants) below — migrated verbatim (adapted to this
// file's own `txn(id)` fixture shape) so deleting it loses no coverage.
describe("computeMatchStatus — non-AI precedence (Pilot Review Board follow-up)", () => {
  it("Invalid wins over every other signal when the row is touched and incomplete", () => {
    const t = txn(1);
    t.requiredAction = REQUIRED_ACTION_DUPLICATE_PAYMENT;
    t.ruleId = 1;
    expect(computeMatchStatus(t, true, true)).toEqual({ label: "Invalid", tone: "danger" });
  });

  it("an untouched row is never marked Invalid even if it would otherwise qualify", () => {
    const t = txn(1);
    expect(computeMatchStatus(t, false, true)).not.toEqual({ label: "Invalid", tone: "danger" });
  });

  it("Duplicate outranks Needs Review and Rule Created", () => {
    const t = txn(1);
    t.requiredAction = REQUIRED_ACTION_DUPLICATE_PAYMENT;
    t.ruleId = 1;
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Duplicate", tone: "muted" });
  });

  it("Needs Review outranks Rule Created", () => {
    const t = txn(1);
    t.requiredAction = "Review — confidence below auto-match threshold";
    t.ruleId = 1;
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Needs Review", tone: "critical" });
  });

  it("Rule Created shows when a rule resolved the row and nothing more urgent applies", () => {
    const t = txn(1);
    t.ruleId = 5;
    t.allocationStatus = "Allocated";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Rule Created", tone: "info" });
  });

  it("Matched is green", () => {
    const t = txn(1);
    t.allocationStatus = "Matched";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Matched", tone: "good" });
  });

  it("Suggested is yellow/warn", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Suggested", tone: "warn" });
  });

  it("Allocated (no rule) is green", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Allocated", tone: "good" });
  });

  it("falls back to Unallocated/grey with no signals", () => {
    expect(computeMatchStatus(txn(1), false, false)).toEqual({ label: "Unallocated", tone: "muted" });
  });
});

describe("computeMatchStatus — AI Suggested (Phase 22A, renamed Phase 28 Part 10)", () => {
  it("shows 'AI Suggested' for an AI-suggested transaction", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    t.allocationMethod = "Future AI";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "AI Suggested", tone: "warn" });
  });

  it("still shows the generic 'Suggested' badge for a Banking-Rule-suggested transaction (allocationMethod not 'Future AI')", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    t.allocationMethod = null;
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Suggested", tone: "warn" });
  });

  it("Rule Created still outranks AI Suggested if a ruleId is somehow also present", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    t.allocationMethod = "Future AI";
    t.ruleId = 9;
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Rule Created", tone: "info" });
  });

  it("Needs Review still outranks AI Suggested", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    t.allocationMethod = "Future AI";
    t.requiredAction = "Some review reason";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Needs Review", tone: "critical" });
  });

  it("a Future AI allocationMethod with allocationStatus 'Matched' (never produced by AI, defensive) falls through to the generic Matched badge", () => {
    const t = txn(1);
    t.allocationStatus = "Matched";
    t.allocationMethod = "Future AI";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Matched", tone: "good" });
  });
});

// Phase 26A — Automatic AI Allocation. A genuinely High-confidence
// classification could write allocation_status: 'Allocated' directly
// (see transaction-classification-service.ts::targetStatusFor) — the
// grid must show this as visibly, textually distinct from BOTH the
// generic "Allocated" badge (which could be Rule/Matching-driven) and
// "AI Suggested" above, so the user can always tell whether AI merely
// suggested something or actually allocated it.
//
// Phase 28, Part 10 — the forensic investigation found the label alone
// wasn't enough (same "good"/green tone as a real confirmed allocation
// let it read as "done" at a glance). Now "warn", matching AI Suggested's
// visual weight — an AI-sourced allocation is never presented as more
// settled than a plain Suggested row until a human actually Accepts it.
describe("computeMatchStatus — AI Allocated (Phase 26A, tone corrected Phase 28 Part 10)", () => {
  it("shows 'AI Allocated' — not bare 'Allocated' — for a transaction AI automatically allocated, with the SAME amber weight as AI Suggested (never the 'confirmed' green)", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Future AI";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "AI Allocated", tone: "warn" });
  });

  it("is textually distinct from AI Suggested — never confusable in the UI", () => {
    const suggested = txn(1);
    suggested.allocationStatus = "Suggested";
    suggested.allocationMethod = "Future AI";
    const allocated = txn(2);
    allocated.allocationStatus = "Allocated";
    allocated.allocationMethod = "Future AI";

    expect(computeMatchStatus(suggested, false, false).label).toBe("AI Suggested");
    expect(computeMatchStatus(allocated, false, false).label).toBe("AI Allocated");
    expect(computeMatchStatus(suggested, false, false).label).not.toBe(computeMatchStatus(allocated, false, false).label);
  });

  it("a plain 'Allocated' status with no AI involvement (allocationMethod not 'Future AI') still shows the generic badge, never 'AI Allocated'", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Manual";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Allocated", tone: "good" });
  });

  it("Rule Created still outranks AI Allocated if a ruleId is somehow also present", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Future AI";
    t.ruleId = 9;
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Rule Created", tone: "info" });
  });

  it("Needs Review still outranks AI Allocated", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Future AI";
    t.requiredAction = "Some review reason";
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Needs Review", tone: "critical" });
  });

  it("Invalid (touched + invalid) still outranks AI Allocated", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Future AI";
    expect(computeMatchStatus(t, true, true)).toEqual({ label: "Invalid", tone: "danger" });
  });
});

// Phase 28, Part 10 — "Any auto allocation that did not come from a
// rule must clearly show Accept." Real production evidence (Phase 28's
// forensic investigation) found ~165 AI-Allocated rows with no visible
// way to tell they were AI-decided rather than human/rule-confirmed.
describe("needsAiAcceptAction (Phase 28, Part 10)", () => {
  it("true for an AI-Allocated row", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Future AI";
    expect(needsAiAcceptAction(t)).toBe(true);
  });

  it("true for an AI-Suggested row", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    t.allocationMethod = "Future AI";
    expect(needsAiAcceptAction(t)).toBe(true);
  });

  it("false for a plain Allocated row with no AI involvement", () => {
    const t = txn(1);
    t.allocationStatus = "Allocated";
    t.allocationMethod = "Manual";
    expect(needsAiAcceptAction(t)).toBe(false);
  });

  it("false for a Rule-suggested row (allocationMethod not 'Future AI')", () => {
    const t = txn(1);
    t.allocationStatus = "Suggested";
    t.allocationMethod = null;
    t.ruleId = 9;
    expect(needsAiAcceptAction(t)).toBe(false);
  });

  it("false for a Matched row, even if somehow tagged Future AI (defensive — AI never produces Matched)", () => {
    const t = txn(1);
    t.allocationStatus = "Matched";
    t.allocationMethod = "Future AI";
    expect(needsAiAcceptAction(t)).toBe(false);
  });

  it("false for a genuinely Unallocated row", () => {
    const t = txn(1);
    expect(needsAiAcceptAction(t)).toBe(false);
  });
});

// Pilot Review Board follow-up — "must remain responsive with 10,000+
// transactions... only visible rows should render." jsdom has no real
// layout engine (every measured height is 0, and there's no
// ResizeObserver), so it cannot exercise the actual windowing behaviour
// the way a real browser would — with a genuinely zero-height scroll
// container, `@tanstack/react-virtual` correctly computes an empty
// visible range, so this environment cannot assert "some rows are
// rendered" without first faking a realistic container size. What CAN
// be verified here: the virtualized render doesn't crash, the header
// still renders correctly, and it never mounts every one of 300 loaded
// rows into the DOM at once (which a non-virtualized `.map()` over all
// rows — the Phase 1 implementation before this change — would have
// done regardless of jsdom's layout limitations). Real windowing
// behaviour (does scrolling actually keep only the visible ~15 rows
// mounted) needs a real browser to verify — no browser automation is
// available in this environment.
// Phase 38 — Phase 37's production audit found Inactive suppliers
// (deactivated merge duplicates) selectable in the Account Code cell's
// unified allocation picker. `TransactionGrid`'s row virtualization means
// jsdom can't exercise a real cell interaction in this test environment
// (see `prunePendingEdits`'s own note above) — `buildAccountCodeOptions`
// is the extracted pure function this exact cell logic now runs through,
// so the filter is tested directly rather than via a row click.
describe("buildAccountCodeOptions — Active-only suppliers (Phase 38)", () => {
  const activeSupplier = supplier({ id: 1, name: "Acme Supplies", status: "Active" });
  const inactiveSupplier = supplier({ id: 2, name: "Acme Supplies (dup)", status: "Inactive" });
  const fixtures = { chartOfAccounts: [], suppliers: [activeSupplier, inactiveSupplier], customers: [] };

  it("Type S: includes the Active supplier and excludes the Inactive one", () => {
    const options = buildAccountCodeOptions("S", fixtures);
    expect(options.map((o) => o.value)).toEqual(["s:1"]);
  });

  it("Type null (unified picker before Type is chosen): still excludes the Inactive supplier", () => {
    const options = buildAccountCodeOptions(null, fixtures);
    const supplierValues = options.filter((o) => o.group === "Suppliers").map((o) => o.value);
    expect(supplierValues).toEqual(["s:1"]);
  });

  it("Type G/C are unaffected by the supplier filter", () => {
    expect(buildAccountCodeOptions("G", fixtures)).toEqual([{ value: "g:__add_new__", label: "+ Add General Ledger Account", sublabel: "", group: "General Ledger", searchText: "add general ledger account new" }]);
    expect(buildAccountCodeOptions("C", fixtures)).toEqual([]);
  });
});

// Phase 38, test #11 — "historical records referencing an Inactive
// supplier remain readable." The Supplier display column
// (`matchedSupplierName ?? beneficiary`, see the grid's own column
// definition) reads a name DENORMALIZED onto the transaction row itself
// at match/allocation time — it never looks the id up against the
// (now Active-only-filtered) `suppliers` prop array. This test encodes
// that invariant directly: a transaction matched to a supplier id that
// is NOT present in the suppliers list at all (exactly what happens once
// that supplier is deactivated and filtered out of every picker) still
// carries its own resolved name, completely unaffected by the Phase 38
// filtering fix.
describe("Historical supplier display is independent of the Active-only picker filter (Phase 38, item 11)", () => {
  it("a transaction's own matchedSupplierName survives even when its supplier id is absent from the (filtered) suppliers list", () => {
    const t = txn(1);
    t.matchedSupplierId = 474; // one of the real Phase 33/36 deactivated duplicate ids
    t.matchedSupplierName = "Cutting Edge Cuisine - Sushi Counters (Internal Sales Acc";

    // Exactly the accessor `transaction-grid.tsx`'s Supplier column uses.
    const displayed = t.matchedSupplierName ?? t.beneficiary;

    expect(displayed).toBe("Cutting Edge Cuisine - Sushi Counters (Internal Sales Acc");
    // Proves the assertion doesn't depend on the supplier being
    // resolvable in any suppliers array at all — an empty/Active-only
    // list changes nothing about this value.
    const emptySuppliersList: never[] = [];
    expect(emptySuppliersList.find((s) => (s as { id: number }).id === t.matchedSupplierId)).toBeUndefined();
    expect(displayed).toBe("Cutting Edge Cuisine - Sushi Counters (Internal Sales Acc");
  });
});

describe("TransactionGrid virtualization", () => {
  it("renders without crashing, keeps the header, and never mounts all loaded rows at once", () => {
    render(
      <TransactionGrid
        transactions={TRANSACTIONS}
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
        onAllocateRow={async () => ({ ok: true }) as const}
        onBulkAllocate={async () => true}
        onCheckDuplicateRule={async () => null}
        onMerchantClick={() => {}}
        onSplitTransaction={() => {}}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    const bodyRows = document.querySelectorAll("tbody tr");
    // Phase 42 — this assertion previously read `toBeLessThan(TRANSACTIONS.length)`
    // ALONE, which is true even at zero rows — and jsdom's lack of a real
    // layout engine (`offsetHeight`/`offsetWidth` always 0, see the
    // "Checkbox selection" describe block below for the full explanation)
    // meant that's exactly what was happening here: this test had been
    // silently passing while mounting NO rows at all. Asserting a
    // non-zero lower bound too is what makes this test actually prove
    // virtualization is rendering something, not merely "not everything."
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.length).toBeLessThan(TRANSACTIONS.length);
  });
});

/**
 * Phase 43, Test 9 — production defect: after the reported freeze, only a
 * full logout/login (a fresh mount of the entire tree) recovered the app.
 * A real `<TransactionExplorer>` mount/unmount/remount can't be exercised
 * here (confirmed, twice, to crash the jsdom worker — see the doc comment
 * on `beginTrackedFetch`/`isCurrentFetch` in transaction-explorer.test.tsx),
 * so this proves the same property at the grid level, which IS safely
 * renderable: unmounting `TransactionGrid` and mounting a genuinely fresh
 * instance (fresh props, fresh selection state, same underlying data)
 * behaves exactly like a first mount — no virtualizer/DOM/selection state
 * survives across the unmount to corrupt the next render.
 */
describe("TransactionGrid — mount, unmount, remount lifecycle (Phase 43, Test 9)", () => {
  it("a fresh mount after unmount renders identically to the first mount — no selection or virtualizer state leaks across instances", () => {
    const first = render(
      <TransactionGrid {...baseGridProps({ transactions: TRANSACTIONS, rowSelection: { "1": true, "2": true } })} />,
    );
    expect(document.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    first.unmount();

    // Nothing left mounted after unmount — the previous instance's DOM is gone.
    expect(document.body.querySelectorAll("table").length).toBe(0);

    // A fresh instance, with fresh (unselected) selection state, as the
    // real explorer creates on every navigate-back-to-Explorer mount.
    const second = render(<TransactionGrid {...baseGridProps({ transactions: TRANSACTIONS, rowSelection: {} })} />);
    const bodyRows = document.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.length).toBeLessThan(TRANSACTIONS.length);
    // None of the previous instance's checked rows carried over.
    expect(document.querySelectorAll("tbody input[type='checkbox']:checked").length).toBe(0);
    second.unmount();
  });

  it("repeated mount/unmount cycles (simulating repeated navigation to and from Explorer) never throw and always render rows", () => {
    for (let cycle = 0; cycle < 4; cycle += 1) {
      const { unmount } = render(<TransactionGrid {...baseGridProps({ transactions: TRANSACTIONS })} />);
      expect(document.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
      unmount();
      expect(document.body.querySelectorAll("table").length).toBe(0);
    }
  });
});

/** Phase 43 — production defect: "No transactions match the current
 * filters." was rendered for BOTH a genuinely empty result AND a failed
 * fetch (the grid was never even given an `error` prop before this
 * phase) — a transient failure looked indistinguishable from "there's
 * nothing here," with no way to retry. These prove all three states are
 * now genuinely distinct, and that `error` always wins over an empty
 * `rowCount`, never the reverse. */
function baseGridProps(overrides: Partial<Parameters<typeof TransactionGrid>[0]> = {}) {
  return {
    transactions: [],
    sorting: [] as SortingState,
    onSortingChange: () => {},
    columnVisibility: {},
    onColumnVisibilityChange: () => {},
    rowSelection: {},
    onRowSelectionChange: () => {},
    columnSizing: {},
    onColumnSizingChange: () => {},
    onRowClick: () => {},
    suppliers: [],
    customers: [],
    chartOfAccounts: [],
    vatTreatments: [],
    onAllocateRow: async () => ({ ok: true }) as const,
    onBulkAllocate: async () => true,
    onCheckDuplicateRule: async () => null,
    onMerchantClick: () => {},
    onSplitTransaction: () => {},
    ...overrides,
  };
}

describe("TransactionGrid — three genuinely distinct loading/error/empty states (Phase 43)", () => {
  it("loading takes precedence over everything else, even when an error is also set", () => {
    render(<TransactionGrid {...baseGridProps({ loading: true, error: "Request failed (500)" })} />);
    expect(screen.getByText("Loading transactions…")).toBeInTheDocument();
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
  });

  it("a failed fetch shows an explicit error state with Retry — NOT the empty-result message", () => {
    render(<TransactionGrid {...baseGridProps({ loading: false, error: "Couldn't reach the API. Check your connection and try again.", onRetry: () => {} })} />);

    expect(screen.getByText(/unable to load transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/couldn't reach the api/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // The exact production defect: these two must never both be findable
    // in a failure state.
    expect(screen.queryByText("No transactions match the current filters.")).not.toBeInTheDocument();
  });

  it("clicking Retry calls onRetry", () => {
    const onRetry = vi.fn();
    render(<TransactionGrid {...baseGridProps({ loading: false, error: "Request failed (500)", onRetry })} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a genuinely empty result (no error) still shows the plain empty-state message", () => {
    render(<TransactionGrid {...baseGridProps({ loading: false, error: null, transactions: [] })} />);
    expect(screen.getByText("No transactions match the current filters.")).toBeInTheDocument();
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
  });

  it("error always wins over an empty rowCount, never the other way around", () => {
    // Same empty `transactions` array in both failure and success cases —
    // the ONLY thing that should change which message renders is `error`.
    const { rerender } = render(<TransactionGrid {...baseGridProps({ loading: false, error: "Request failed (500)", transactions: [] })} />);
    expect(screen.getByText(/unable to load transactions/i)).toBeInTheDocument();

    rerender(<TransactionGrid {...baseGridProps({ loading: false, error: null, transactions: [] })} />);
    expect(screen.getByText("No transactions match the current filters.")).toBeInTheDocument();
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
  });
});

/** Phase 42 — the missing link. Every prior test either gave
 * `TransactionBulkActionBar` a `selected` array directly (proving the
 * toolbar renders correctly GIVEN a selection) or rendered `TransactionGrid`
 * alone (proving the grid itself mounts) — nothing ever proved that
 * checking a row's checkbox actually produces a selection that reaches
 * the toolbar, which is the literal, reported, live production defect.
 * This harness wires the two REAL components together exactly the way
 * `transaction-explorer.tsx` does — `rowSelection`/`setRowSelection`
 * lifted to a parent, `selected` derived from it via `getRowId`-matched
 * filtering, passed into `TransactionBulkActionBar` — with none of
 * `TransactionExplorer`'s other machinery (fetch effects, detail panel,
 * Add Transaction panel) that made a full-page render crash the jsdom
 * worker (see `transaction-explorer.test.tsx`'s own doc comment). */
function SelectionHarness({ transactions, onDeleteTransactions }: { transactions: ReturnType<typeof txn>[]; onDeleteTransactions: () => void }) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // The EXACT derivation `transaction-explorer.tsx::selectedTransactions`
  // uses — not a simplified stand-in.
  const selected = transactions.filter((t) => rowSelection[String(t.id)]);
  return (
    <>
      <TransactionGrid
        transactions={transactions}
        sorting={[]}
        onSortingChange={() => {}}
        columnVisibility={{}}
        onColumnVisibilityChange={() => {}}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        columnSizing={{}}
        onColumnSizingChange={() => {}}
        onRowClick={() => {}}
        suppliers={[]}
        customers={[]}
        chartOfAccounts={[]}
        vatTreatments={[]}
        onAllocateRow={async () => ({ ok: true }) as const}
        onBulkAllocate={async () => true}
        onCheckDuplicateRule={async () => null}
        onMerchantClick={() => {}}
        onSplitTransaction={() => {}}
      />
      <TransactionBulkActionBar
        companyId="co_1"
        onPosted={() => {}}
        selected={selected}
        suppliers={[]}
        customers={[]}
        merchants={[]}
        chartOfAccounts={[]}
        vatTreatments={[]}
        onAssignSupplier={() => {}}
        onAssignMerchant={() => {}}
        onAssignCustomer={() => {}}
        onAssignGl={() => {}}
        onAssignVat={() => {}}
        onReview={() => {}}
        onGenerateJournal={() => {}}
        onApplyRule={() => {}}
        onDeleteImport={() => {}}
        onDeleteTransactions={onDeleteTransactions}
        onClassifyWithAi={() => {}}
        onSaveSelected={() => {}}
        saveSelectedDirtyCount={0}
        savingSelected={false}
        pendingAllocationIds={new Set()}
        onCommitPendingAllocations={async () => null}
        summarizeSave={() => ""}
        loading={false}
        previewMode={false}
      />
    </>
  );
}

/**
 * Phase 44 — production defect: creating a GL account from "+ Add General
 * Ledger Account" (reachable from any row's Account combobox) used to
 * call `router.refresh()`, forcing Transaction Explorer's whole page to
 * reload — a confirmed, reproduced cause of a browser-level "Page
 * Unresponsive" hang. `onGlAccountCreated` replaces that: the created
 * account is reported straight up to the parent so it can be appended to
 * local state with no page reload. This exercises the REAL combobox →
 * modal → create flow end to end, not just the modal in isolation.
 */
/**
 * Phase 46 — CONFIRMED root cause of the repeated production freeze,
 * reproduced across three separate reports and NOT fixed by Phases 44-45
 * (which removed a real but separate `router.refresh()` defect). Source-
 * level evidence: `TransactionGrid`'s own effect —
 *   useEffect(() => { onPendingEditsChange?.(pendingEdits.size, new
 *   Set(pendingEdits.keys()), triage); }, [pendingEdits, onPendingEditsChange])
 * — re-runs whenever `onPendingEditsChange`'s REFERENCE changes, not only
 * when `pendingEdits` itself changes. Before this phase, the parent
 * (`transaction-explorer.tsx`) passed a brand-new inline arrow function on
 * every render: `onPendingEditsChange={(count, ids) => {...}}`. That
 * function's identity changed on every parent render → the effect above
 * re-ran on every commit → it called back with `new Set(pendingEdits.keys())`,
 * a NEW Set object regardless of content → `setDirtyIds(newSet)` can never
 * bail via React's `Object.is` equality check (different object
 * references), so the parent was FORCED to re-render → which recreated the
 * inline handler again → forever. No user interaction was needed; it
 * started on mount. The fix (`transaction-explorer.tsx`, `handlePendingEditsChange`)
 * wraps the handler in `useCallback(fn, [])`, giving it a stable identity
 * — these tests prove exactly the property that fix depends on: a stable
 * callback does NOT cause repeated firing across unrelated re-renders,
 * while an unstable one (the pre-fix shape) does, 1:1 with each re-render.
 * Each re-render here is driven manually by the test, never by the
 * component's own effect calling back into itself, so this cannot hang —
 * it's a controlled reproduction of the mechanism, not a live loop.
 *
 * This is also why the effect deliberately reads the current rows through
 * `transactionsRef` instead of taking `transactions` as a dependency:
 * `transactions` gets a fresh array identity on every parent render, so
 * depending on it would re-arm exactly the loop described above.
 */
describe("onPendingEditsChange — infinite render loop fix (Phase 46)", () => {
  it("a STABLE callback (the production fix) is invoked once on mount and NEVER again across unrelated re-renders", () => {
    const stableCallback = vi.fn();
    const { rerender } = render(<TransactionGrid {...baseGridProps({ onPendingEditsChange: stableCallback })} />);
    expect(stableCallback).toHaveBeenCalledTimes(1);
    // The third argument (added when "Update Allocated" learned to count
    // only the pending edits the grid will actually commit) is the triage
    // of those edits — empty here, because nothing is pending.
    expect(stableCallback).toHaveBeenCalledWith(0, new Set(), { committableIds: new Set(), blocked: [] });

    // Five unrelated re-renders (the SAME callback reference, only some
    // other prop changes) — exactly what happens every time ANY other
    // state in the real parent changes for any reason.
    for (let i = 0; i < 5; i += 1) {
      rerender(<TransactionGrid {...baseGridProps({ onPendingEditsChange: stableCallback, loading: i % 2 === 0 })} />);
    }
    expect(stableCallback).toHaveBeenCalledTimes(1);
  });

  it("an UNSTABLE callback (the pre-fix shape — a new function every render) is invoked once per re-render even though nothing about pending edits changed — this is the exact defect mechanism", () => {
    const calls: unknown[] = [];
    const { rerender } = render(<TransactionGrid {...baseGridProps({ onPendingEditsChange: (c, ids) => calls.push([c, ids]) })} />);
    expect(calls).toHaveLength(1);

    for (let i = 0; i < 5; i += 1) {
      // A fresh inline function every render — reproducing exactly what
      // `onPendingEditsChange={(count, ids) => {...}}` did in the parent
      // before this phase.
      rerender(<TransactionGrid {...baseGridProps({ onPendingEditsChange: (c, ids) => calls.push([c, ids]) })} />);
    }
    // Every one of the 5 unrelated re-renders re-invoked the callback —
    // in the real app, each of THOSE calls fed a new-identity Set into
    // `setDirtyIds`, which cannot bail, forcing yet another parent
    // re-render — the self-sustaining loop. This assertion is what a
    // correct implementation must NOT exhibit (see the test above).
    expect(calls).toHaveLength(6);
  });
});

describe("Add General Ledger Account — no page-level refresh needed (Phase 44)", () => {
  it("creating a new GL account from the combobox reports it via onGlAccountCreated, never triggers a page reload", async () => {
    const createdAccount = { id: 501, companyId: "c1", accountCode: "6950", description: "Marketing Materials", accountType: "Expense" as const, normalBalance: "Debit" as const, isActive: true, isControlAccount: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: createdAccount }) }));
    const onGlAccountCreated = vi.fn();

    render(<TransactionGrid {...baseGridProps({ transactions: [txn(1)], onGlAccountCreated })} />);

    const accountInput = screen.getByRole("combobox", { name: "Account" });
    fireEvent.focus(accountInput);
    const addNewOption = screen.getByRole("option", { name: "+ Add General Ledger Account" });
    fireEvent.mouseDown(addNewOption);

    expect(screen.getByRole("heading", { name: "Add General Ledger Account" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Account Code"), { target: { value: "6950" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Marketing Materials" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(onGlAccountCreated).toHaveBeenCalledWith(createdAccount));
    // The whole point of this fix: no navigation/refresh mechanism is
    // ever invoked — `fetch` was called exactly once, for the account
    // creation POST itself, and nothing else.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Add General Ledger Account" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("Checkbox selection actually reaches the Delete toolbar — the reported live defect (Phase 42)", () => {
  it("no toolbar is rendered at all before anything is selected", () => {
    render(<SelectionHarness transactions={[txn(1), txn(2), txn(3)]} onDeleteTransactions={vi.fn()} />);
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("clicking ONE row's checkbox in the real rendered grid causes the real toolbar to show '1 selected' and a Delete button", () => {
    render(<SelectionHarness transactions={[txn(1), txn(2), txn(3)]} onDeleteTransactions={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: "Select transaction 1" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("clicking a SECOND row's checkbox shows 'Delete Selected' instead of plain 'Delete'", () => {
    render(<SelectionHarness transactions={[txn(1), txn(2), txn(3)]} onDeleteTransactions={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select transaction 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select transaction 2" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Selected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("un-checking the only selected row makes the toolbar disappear again", () => {
    render(<SelectionHarness transactions={[txn(1), txn(2)]} onDeleteTransactions={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select transaction 1" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    // Re-query rather than reuse the earlier reference — the row (and its
    // checkbox) re-renders on every selection change.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select transaction 1" }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("the full click path: select a row, click Delete, confirm, and the real onDeleteTransactions callback fires", () => {
    const onDeleteTransactions = vi.fn();
    render(<SelectionHarness transactions={[txn(1), txn(2)]} onDeleteTransactions={onDeleteTransactions} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select transaction 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText(/delete this transaction\?/i)).toBeInTheDocument();
    expect(onDeleteTransactions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Transactions" }));
    expect(onDeleteTransactions).toHaveBeenCalledTimes(1);
  });

  it("Cancel on the confirmation never calls onDeleteTransactions, and the selection survives", () => {
    const onDeleteTransactions = vi.fn();
    render(<SelectionHarness transactions={[txn(1), txn(2)]} onDeleteTransactions={onDeleteTransactions} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select transaction 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDeleteTransactions).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Select transaction 1" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

// Master Implementation Tracker — Epic E11, Finding #224 (RC-9). The
// grid itself is virtualized and jsdom reports a zero-height scroll
// container (see the note above), so row-level interaction can't be
// exercised here — `prunePendingEdits` is pure and exported specifically
// so this decision logic is directly testable regardless.
describe("prunePendingEdits (Finding #224, RC-9)", () => {
  it("removes an edit whose row is no longer in the visible set", () => {
    const pending = new Map([[1, { type: "G" as const }], [2, { type: "S" as const }]]);
    const result = prunePendingEdits(pending, [{ id: 2 }, { id: 3 }]);

    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("keeps every edit whose row is still visible, and returns the same reference when nothing changed", () => {
    const pending = new Map([[1, { type: "G" as const }]]);
    const result = prunePendingEdits(pending, [{ id: 1 }, { id: 2 }]);

    expect(result).toBe(pending); // no change — same Map reference, no unnecessary re-render
  });

  it("is a no-op on an empty map", () => {
    const pending = new Map();
    expect(prunePendingEdits(pending, [{ id: 1 }])).toBe(pending);
  });
});

// Phase 29 — the Set Rule preview tooltip must reflect whatever the
// accountant actually confirmed in `SetRuleModal` (edited search text +
// match type), never a hardcoded "Contains <full beneficiary>", so what
// the accountant sees in the preview always matches what will really be
// created.
describe("rulePreviewText (Phase 29)", () => {
  const t = txn(1);
  t.beneficiary = "FNB OB Pmt FNB OB 000024505 Ren Remuneration";
  t.bankAccount = "Cheque Account";
  const edit = { ...initialEdit(t), type: "G" as const, accountCode: "6940", vatCode: "STD" };
  const chartOfAccounts = [{ id: 1, companyId: "c1", accountCode: "6940", description: "Salaries & Wages", accountType: "Expense" as const, category: "", normalBalance: "Debit" as const, parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00.000Z" }];

  it("falls back to Contains + the full beneficiary when no rule options are given yet", () => {
    const preview = rulePreviewText(t, edit, chartOfAccounts, [], [], null);
    expect(preview).toContain('Rule: Contains "FNB OB Pmt FNB OB 000024505 Ren Remuneration"');
  });

  it("reflects the accountant's EDITED search text and match type, not the full description", () => {
    const options: RuleCreationOptions = { matchField: "description", matchDescription: "Ren Remuneration", matchType: "exact", applyToRemaining: true, applyToFutureImports: true };
    const preview = rulePreviewText(t, edit, chartOfAccounts, [], [], options);
    expect(preview).toContain('Rule: Exact Match "Ren Remuneration"');
    expect(preview).not.toContain("FNB OB Pmt FNB OB 000024505 Ren Remuneration");
  });

  it("names which field the rule actually matches against (Phase 31B)", () => {
    const descriptionOptions: RuleCreationOptions = { matchField: "description", matchDescription: "Ren Remuneration", matchType: "exact", applyToRemaining: true, applyToFutureImports: true };
    expect(rulePreviewText(t, edit, chartOfAccounts, [], [], descriptionOptions)).toContain("matching Description");

    const beneficiaryOptions: RuleCreationOptions = { matchField: "beneficiary", matchDescription: "Ren Remuneration", matchType: "exact", applyToRemaining: true, applyToFutureImports: true };
    expect(rulePreviewText(t, edit, chartOfAccounts, [], [], beneficiaryOptions)).toContain("matching Beneficiary");
  });

  it("includes the resolved account description and VAT code", () => {
    const preview = rulePreviewText(t, edit, chartOfAccounts, [], [], null);
    expect(preview).toContain("Allocate: GL — Salaries & Wages");
    expect(preview).toContain("VAT: STD");
  });
});

// Phase 29A — forensic review requirement: "Save cannot accidentally
// create a Banking Rule unless Set Rule was explicitly configured," and
// "the edited search text is what gets saved." Extracted from `commitRow`
// as a pure function specifically so this separation is directly
// unit-testable (see the file's own note on jsdom virtualization).
describe("ruleOptionsForCommit (Phase 29A, Phase 31B)", () => {
  const transaction = { id: 501 };
  const edit = { setRule: true, description: "Ren Remuneration" };

  it("returns null — never a rule — when Set Rule was not checked, regardless of what's in ruleOptionsByTransaction", () => {
    const ruleOptionsByTransaction = new Map([[501, { matchField: "description" as const, matchDescription: "Ren Remuneration", matchType: "contains" as const, applyToRemaining: true, applyToFutureImports: true }]]);
    expect(ruleOptionsForCommit({ setRule: false, description: "Ren Remuneration" }, transaction, ruleOptionsByTransaction)).toBeNull();
  });

  it("returns the accountant's edited options when Set Rule was confirmed via the modal", () => {
    const edited = { matchField: "beneficiary" as const, matchDescription: "Ren Remuneration", matchType: "exact" as const, applyToRemaining: false, applyToFutureImports: true };
    const ruleOptionsByTransaction = new Map([[501, edited]]);
    expect(ruleOptionsForCommit(edit, transaction, ruleOptionsByTransaction)).toEqual(edited);
  });

  it("falls back to matching the CURRENT description only defensively, when Set Rule is true but no modal confirmation was ever stored", () => {
    const result = ruleOptionsForCommit(edit, transaction, new Map());
    // Phase 51 — production defect: `applyToRemaining` used to default to
    // true here, silently sweeping the whole company the moment a rule
    // was created — see the Phase 50 forensic report.
    expect(result).toEqual({ matchField: "description", matchDescription: "Ren Remuneration", matchType: "contains", applyToRemaining: false, applyToFutureImports: true });
  });

  it("Phase 51 — the fallback default for Apply to Remaining Transactions is explicitly false, never true", () => {
    const result = ruleOptionsForCommit(edit, transaction, new Map());
    expect(result?.applyToRemaining).toBe(false);
  });

  it("never leaks another transaction's pending rule options", () => {
    const ruleOptionsByTransaction = new Map([[999, { matchField: "description" as const, matchDescription: "Some other rule", matchType: "contains" as const, applyToRemaining: true, applyToFutureImports: true }]]);
    const result = ruleOptionsForCommit(edit, transaction, ruleOptionsByTransaction);
    expect(result?.matchDescription).toBe(edit.description); // falls back to its OWN default, not id 999's options
  });
});

/**
 * Phase 51 — production defect (Phase 50's forensic report): checking
 * "Set Rule" on a row used to open with "Apply to Remaining Transactions"
 * checked by default, so saving that one row could silently reallocate
 * an unbounded number of OTHER, untouched transactions company-wide.
 * This exercises the REAL, rendered checkbox → real, rendered
 * `SetRuleModal` — not the pure `ruleOptionsForCommit` fallback alone —
 * proving the actual on-screen control an accountant sees starts
 * unchecked.
 */
describe("Set Rule checkbox → SetRuleModal opens with Apply to Remaining OFF by default (Phase 51, Fix 1)", () => {
  const GL_ACCOUNT_1010 = {
    id: 11, companyId: "c1", accountCode: "1010", description: "Petty Cash", accountType: "Asset" as const, category: "",
    normalBalance: "Debit" as const, parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "",
    branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true,
    notes: "", createdAt: "2026-01-01T00:00:00Z",
  };

  it("a freshly-checked Set Rule opens the modal with Apply to Remaining Transactions UNCHECKED", () => {
    render(<TransactionGrid {...baseGridProps({ transactions: [txn(1)], chartOfAccounts: [GL_ACCOUNT_1010] })} />);

    // Give the row a valid allocation first — the Set Rule checkbox is
    // disabled until `isAllocationMissing` is false.
    const accountInput = screen.getByRole("combobox", { name: "Account" });
    accountInput.focus();
    fireEvent.focus(accountInput);
    fireEvent.mouseDown(screen.getByRole("option", { name: /^1010/ }));

    const setRuleCheckbox = screen.getByRole("checkbox", { name: "Set rule from this allocation" });
    expect(setRuleCheckbox).not.toBeDisabled();
    fireEvent.click(setRuleCheckbox);

    expect(screen.getByRole("heading", { name: "Create Banking Rule" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Apply to Remaining Transactions" })).not.toBeChecked();
  });
});

/**
 * Phase 51, Test A — "Save transaction WITHOUT Set Rule: only the
 * selected transaction changes, no rule is created, no other transaction
 * changes." `onAllocateRow` is the real, single write path `commitRow`
 * calls (see `transaction-explorer.tsx`'s `allocateRowInline`, which
 * sends exactly `transactionIds: [transaction.id]` and only calls
 * `createRuleFromAllocation` — the ONLY place a rule gets created — when
 * its third argument is truthy). Proving `onAllocateRow` is called with
 * `ruleOptions === null` when Set Rule was never checked is a direct,
 * real proof that no rule creation and no company-wide sweep can follow.
 */
describe("Save without Set Rule — no rule, no company-wide effect (Phase 51, Test A)", () => {
  it("Save on a row that never had Set Rule checked calls onAllocateRow with ruleOptions=null, for exactly that one transaction", async () => {
    const onAllocateRow = vi.fn<
      (transaction: BankTransactionRecord, input: AllocateRowPayload, ruleOptions: RuleCreationOptions | null) => Promise<{ ok: true } | { ok: false; error: string }>
    >(async () => ({ ok: true }));
    const account = { id: 11, companyId: "c1", accountCode: "1010", description: "Petty Cash", accountType: "Asset" as const, category: "", normalBalance: "Debit" as const, parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z" };
    render(<TransactionGrid {...baseGridProps({ transactions: [txn(1), txn(2)], chartOfAccounts: [account], onAllocateRow })} />);

    const accountInput = screen.getAllByRole("combobox", { name: "Account" })[0];
    accountInput.focus();
    fireEvent.focus(accountInput);
    fireEvent.mouseDown(screen.getByRole("option", { name: /^1010/ }));

    // Set Rule is NOT touched — stays unchecked, per its own default.
    const setRuleCheckboxes = screen.getAllByRole("checkbox", { name: "Set rule from this allocation" });
    for (const cb of setRuleCheckboxes) expect(cb).not.toBeChecked();

    // Two rows are rendered — click only the FIRST row's Save button.
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(onAllocateRow).toHaveBeenCalledTimes(1));

    const [savedTransaction, , ruleOptionsArg] = onAllocateRow.mock.calls[0];
    expect(savedTransaction.id).toBe(1); // only the one row that was actually saved
    expect(ruleOptionsArg).toBeNull(); // the real signal `createRuleFromAllocation` gates on — never called when this is null
  });
});

// ---------------------------------------------------------------------
// Phase 31 — "Save Selected." The actual per-row write path is already
// covered above (`commitRow` reuses `onAllocateRow`, unchanged); these
// tests cover the NEW decision logic Save Selected adds on top of it —
// which selected rows are actually dirty, how a batch of independent
// per-row outcomes becomes the one summary the toolbar/banner shows, and
// that a large selection never fires unbounded concurrent requests.
// ---------------------------------------------------------------------

describe("isAllocationMissing (Phase 29, exported Phase 31)", () => {
  it("missing when Type has never been chosen", () => {
    expect(isAllocationMissing({ type: null, accountCode: "", supplierId: null, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(true);
  });

  it("missing for Type G with no account code", () => {
    expect(isAllocationMissing({ type: "G", accountCode: "  ", supplierId: null, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(true);
  });

  it("missing for Type S with no supplier chosen", () => {
    expect(isAllocationMissing({ type: "S", accountCode: "", supplierId: null, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(true);
  });

  it("missing for Type C with no customer chosen", () => {
    expect(isAllocationMissing({ type: "C", accountCode: "", supplierId: null, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(true);
  });

  it("not missing once a real target is chosen for the row's Type", () => {
    expect(isAllocationMissing({ type: "G", accountCode: "6100", supplierId: null, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(false);
    expect(isAllocationMissing({ type: "S", accountCode: "", supplierId:7, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(false);
    expect(isAllocationMissing({ type: "C", accountCode: "", supplierId: null, customerId:42, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false })).toBe(false);
  });
});

describe("selectDirtyIds (Phase 31)", () => {
  const edit = { type: "G" as const, accountCode: "6100", supplierId: null, customerId: null, vatCode: "", allocationNotes: "", description: "", setRule: false, overrideSupplierInvoiceMatching: false };

  it("50 selected / 10 dirty — only the 10 with a real pending edit are returned", () => {
    const selectedIds = Array.from({ length: 50 }, (_, i) => i + 1);
    const pendingEdits = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, edit] as const));
    expect(selectDirtyIds(selectedIds, pendingEdits)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("selected rows with no changes at all — nothing is dirty", () => {
    expect(selectDirtyIds([1, 2, 3], new Map())).toEqual([]);
  });

  it("a dirty row that isn't selected is never included", () => {
    const pendingEdits = new Map([[99, edit]]);
    expect(selectDirtyIds([1, 2, 3], pendingEdits)).toEqual([]);
  });
});

describe("summarizeBulkSaveOutcomes (Phase 31)", () => {
  it("the documented example — 32 changed, 30 saved, 2 failed, 18 unchanged", () => {
    const outcomes: BulkSaveOutcome[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: i + 1, ok: true })),
      { id: 31, ok: false, reason: "Transaction is posted" },
      { id: 32, ok: false, reason: "Missing account, supplier, or customer" },
    ];
    const summary = summarizeBulkSaveOutcomes(outcomes, 18);
    expect(summary).toEqual({
      saved: 30,
      unchanged: 18,
      failed: [
        { id: 31, reason: "Transaction is posted" },
        { id: 32, reason: "Missing account, supplier, or customer" },
      ],
    });
  });

  it("every row succeeding never leaves anything in `failed`", () => {
    const outcomes: BulkSaveOutcome[] = [{ id: 1, ok: true }, { id: 2, ok: true }];
    expect(summarizeBulkSaveOutcomes(outcomes, 0)).toEqual({ saved: 2, unchanged: 0, failed: [] });
  });

  it("a partial failure never rolls back or hides the rows that DID succeed", () => {
    const outcomes: BulkSaveOutcome[] = [{ id: 1, ok: true }, { id: 2, ok: false, reason: "Transaction is posted" }, { id: 3, ok: true }];
    const summary = summarizeBulkSaveOutcomes(outcomes, 0);
    expect(summary.saved).toBe(2);
    expect(summary.failed).toEqual([{ id: 2, reason: "Transaction is posted" }]);
  });

  it("a missing reason still surfaces as a visible (never blank) failure message", () => {
    const summary = summarizeBulkSaveOutcomes([{ id: 1, ok: false }], 0);
    expect(summary.failed).toEqual([{ id: 1, reason: "Unknown error" }]);
  });
});

describe("runWithConcurrencyLimit (Phase 31)", () => {
  it("processes every item exactly once and preserves result order by input index", async () => {
    const items = [5, 1, 4, 2, 3];
    const results = await runWithConcurrencyLimit(items, 2, async (n) => n * 10);
    expect(results).toEqual([50, 10, 40, 20, 30]);
  });

  it("never runs more than the configured limit concurrently — a 50-row selection must not fire 50 simultaneous requests", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrencyLimit(items, 5, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); // yield, so overlapping calls actually have a chance to race
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1); // proves it's genuinely concurrent, not accidentally sequential
  });

  it("a limit larger than the item count doesn't error or under-run — every item still completes", async () => {
    const results = await runWithConcurrencyLimit([1, 2, 3], 100, async (n) => n + 1);
    expect(results).toEqual([2, 3, 4]);
  });

  it("an empty item list resolves immediately with an empty result", async () => {
    expect(await runWithConcurrencyLimit([], 5, async () => "unreachable")).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Phase 31A — the transaction Description/Narration becomes editable.
// `ae_bank_transactions.description` was already a plain writable text
// column (migration 0002) — no migration was needed. Kept strictly
// separate from `allocationNotes` (an accountant annotation) and from
// Set Rule's own "Rule Search Text" (still defaults from and matches
// against `beneficiary`, unchanged) — see `computeDescriptionUpdate`'s
// and `SetRuleModal`'s own doc comments for the full reasoning.
// ---------------------------------------------------------------------

describe("computeDescriptionUpdate (Phase 31A)", () => {
  const t = { description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration" };

  it("returns null (write nothing) when the edited description is identical to the transaction's current one — item 12: unchanged descriptions are not unnecessarily written", () => {
    expect(computeDescriptionUpdate({ description: t.description }, t)).toBeNull();
  });

  it("returns the trimmed new value when the description genuinely changed", () => {
    expect(computeDescriptionUpdate({ description: "Ren Remuneration" }, t)).toBe("Ren Remuneration");
  });

  it("trims surrounding whitespace before comparing — pure whitespace edits are still treated as unchanged", () => {
    expect(computeDescriptionUpdate({ description: `  ${t.description}  ` }, t)).toBeNull();
  });

  it("a change to empty string is still a real, reportable change (clearing the description)", () => {
    expect(computeDescriptionUpdate({ description: "" }, t)).toBe("");
  });

  it("an already-empty transaction description gaining new text is a real change", () => {
    expect(computeDescriptionUpdate({ description: "New text" }, { description: "" })).toBe("New text");
  });
});

describe("Description editing — dirty tracking and Set Rule independence (Phase 31A)", () => {
  const t: BankTransactionRecord = {
    id: 900, companyId: "c1", transactionDate: "2026-08-01", reference: "REF-900", description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration",
    beneficiary: "FNB OB Pmt FNB OB 000024505 Ren Remuneration", debit: 100, credit: 0, balance: null, bankAccount: "", bankAccountId: 1,
    glAccount: "", vat: null, notes: "", importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00Z",
    allocationStatus: "Allocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: "6100", suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "",
    isManualOverride: true, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null,
    allocationType: "G", allocationNotes: "", entrySource: "Imported", captureStatus: null,
    cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
  };

  it("item 1/2 — a description edit is a real PendingRowEdit field, distinct from allocationNotes and Set Rule's own search text", () => {
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(edit.description).toBe("Ren Remuneration");
    expect(edit.allocationNotes).toBe(t.allocationNotes); // untouched
    expect(edit.setRule).toBe(false); // untouched — see the next test
  });

  it("item 8/9 — editing the description alone never sets setRule, so ruleOptionsForCommit still returns null — no rule is silently created", () => {
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(ruleOptionsForCommit(edit, t, new Map())).toBeNull();
  });

  it("item 3/6 — a description change alone is enough for isAllocationMissing to stay false when the row was already validly allocated, so it can actually be saved", () => {
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(isAllocationMissing(edit)).toBe(false);
  });

  it("item 11 — Save Selected's payload-eligibility logic treats a description-only edit exactly like any other dirty row", () => {
    const pendingEdits = new Map([[t.id, { ...initialEdit(t), description: "Ren Remuneration" }]]);
    expect(selectDirtyIds([t.id, 901, 902], pendingEdits)).toEqual([t.id]);
  });
});

// ---------------------------------------------------------------------
// Phase 31B — "Description must be savable on its own." The five
// required scenarios (Section 1 of the spec, verbatim), each proven
// directly against the extracted decision function — no rendering, no
// network mock needed to prove the eligibility rule itself is correct.
// ---------------------------------------------------------------------

function unallocatedTxn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 950, companyId: "c1", transactionDate: "2026-08-01", reference: "REF-950", description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration",
    beneficiary: "FNB OB Pmt FNB OB 000024505 Ren Remuneration", debit: 100, credit: 0, balance: null, bankAccount: "", bankAccountId: 1,
    glAccount: "", vat: null, notes: "", importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "",
    isManualOverride: false, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null,
    allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null,
    cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

describe("computeCommitEligibility (Phase 31B)", () => {
  it("item 1 — Unallocated transaction + changed Description → SAVE must work", () => {
    const t = unallocatedTxn();
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: true });
  });

  it("item 2 — Unallocated transaction + changed Notes (description untouched) → preserve existing behaviour: still blocked", () => {
    const t = unallocatedTxn();
    const edit = { ...initialEdit(t), allocationNotes: "Follow up with supplier" };
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: false, reason: "No changes to save" });
  });

  it("item 3 — Unallocated + changed Description + no GL allocation → Description must still be saved", () => {
    const t = unallocatedTxn();
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(edit.type).toBeNull();
    expect(edit.accountCode).toBe("");
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: true });
  });

  it("item 4 — Allocated transaction + changed Description → save as before", () => {
    const t = unallocatedTxn({ allocationStatus: "Allocated", allocationType: "G", suggestedGlAccount: "6100", allocationMethod: "Manual", isManualOverride: true });
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: true });
  });

  it("item 5 — Suggested transaction + changed Description → save as before", () => {
    const t = unallocatedTxn({ allocationStatus: "Suggested", allocationType: "G", suggestedGlAccount: "6100", allocationMethod: "Future AI" });
    const edit = { ...initialEdit(t), description: "Ren Remuneration" };
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: true });
  });

  it("an incomplete ALLOCATION ATTEMPT (Type chosen but no target) still blocks, even with a changed description — validation A/C from Section 2 stays intact", () => {
    const t = unallocatedTxn();
    const edit = { ...initialEdit(t), type: "G" as const, accountCode: "", description: "Ren Remuneration" };
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: false, reason: "Missing account, supplier, or customer" });
  });

  it("Description + allocation together (mixed update, Section 2 item D) both succeed as one eligible commit", () => {
    const t = unallocatedTxn();
    const edit = { ...initialEdit(t), type: "G" as const, accountCode: "6100", description: "Ren Remuneration" };
    expect(computeCommitEligibility(edit, t)).toEqual({ ok: true });
  });

  it("unchanged description AND no allocation attempt AND no other field touched → nothing to save", () => {
    const t = unallocatedTxn();
    expect(computeCommitEligibility(initialEdit(t), t)).toEqual({ ok: false, reason: "No changes to save" });
  });
});

// Phase 31B, item 20 — "Mixed Description + GL + Notes changes save
// correctly." `selectDirtyIds`/`computeCommitEligibility`/
// `computeDescriptionUpdate` compose exactly as Save Selected uses them —
// proving the composition, not just each piece in isolation.
describe("Save Selected — mixed field changes (Phase 31B, item 20)", () => {
  it("a batch of allocation-only, description-only, and mixed rows are all correctly identified as dirty and eligible", () => {
    const allocationOnly = unallocatedTxn({ id: 1 });
    const descriptionOnly = unallocatedTxn({ id: 2 });
    const mixed = unallocatedTxn({ id: 3 });
    // Row 4 (id 4) is deliberately never added to pendingEdits — it's the
    // "untouched" row this test proves stays excluded from the dirty set.

    const pendingEdits = new Map([
      [1, { ...initialEdit(allocationOnly), type: "G" as const, accountCode: "6100" }],
      [2, { ...initialEdit(descriptionOnly), description: "Ren Remuneration" }],
      [3, { ...initialEdit(mixed), type: "G" as const, accountCode: "6200", description: "Cleaned up text", allocationNotes: "Reviewed" }],
    ]);

    const dirtyIds = selectDirtyIds([1, 2, 3, 4], pendingEdits);
    expect(dirtyIds).toEqual([1, 2, 3]);
    expect(selectDirtyIds([1, 2, 3, 4], pendingEdits)).not.toContain(4); // untouched row correctly excluded

    expect(computeCommitEligibility(pendingEdits.get(1)!, allocationOnly)).toEqual({ ok: true });
    expect(computeCommitEligibility(pendingEdits.get(2)!, descriptionOnly)).toEqual({ ok: true });
    expect(computeCommitEligibility(pendingEdits.get(3)!, mixed)).toEqual({ ok: true });
  });
});

/**
 * The Xero migration's unclassified transactions carry the export's own
 * "Related Account" text and nothing else. That text is the evidence an
 * accountant classifies from, so it has to be reachable in the grid —
 * and it has to stay clearly separate from VYRON's own allocation, which
 * the accountant owns.
 */
describe("Source Account (as imported) column", () => {
  it("is a real, choosable column, distinct from the GL Account column", () => {
    expect(ALL_COLUMN_IDS).toContain("sourceGlAccount");
    expect(ALL_COLUMN_IDS).toContain("glAccount");
    expect(COLUMN_LABELS.sourceGlAccount).toBe("Source Account (as imported)");
    expect(COLUMN_LABELS.glAccount).toBe("GL Account");
  });

  it("renders the source's own account text for an imported, unclassified transaction", () => {
    const imported = { ...txn(1), glAccount: "3030 - Bank Charges, 820 - VAT", suggestedGlAccount: null, debit: 6, credit: 0 };
    render(<TransactionGrid {...baseGridProps({ transactions: [imported], columnVisibility: { sourceGlAccount: true } })} />);
    expect(screen.getByText("3030 - Bank Charges, 820 - VAT")).toBeInTheDocument();
  });

  it("keeps showing the source account after the transaction has been classified to something else", () => {
    const classified = { ...txn(1), glAccount: "3030 - Bank Charges, 820 - VAT", suggestedGlAccount: "3420" };
    render(<TransactionGrid {...baseGridProps({ transactions: [classified], columnVisibility: { sourceGlAccount: true } })} />);
    expect(screen.getByText("3030 - Bank Charges, 820 - VAT")).toBeInTheDocument();
  });

  it("shows the column header even when the import carried no source account", () => {
    const noSource = { ...txn(1), glAccount: "", suggestedGlAccount: null };
    render(<TransactionGrid {...baseGridProps({ transactions: [noSource], columnVisibility: { sourceGlAccount: true } })} />);
    expect(screen.getByRole("columnheader", { name: /source account/i })).toBeInTheDocument();
  });
});

/** The grid carries three status columns that can each legitimately
 * render the word "Posted" — Matching Status, Journal Status and Posting
 * Status. These assertions are about the LAST of those, so the other two
 * are hidden; otherwise a passing "not Posted" check would only be
 * proving which column happened to render first. */
const POSTING_STATUS_ONLY = { postingStatus: true, journalStatus: false, allocationStatus: false, requiredAction: false };

describe("Posting Status column", () => {
  it("shows Unprocessed for an imported transaction with no allocation", () => {
    const imported = { ...txn(1), suggestedGlAccount: null, isSplit: false, postedFlag: false, reconciliationId: null };
    render(<TransactionGrid {...baseGridProps({ transactions: [imported], columnVisibility: POSTING_STATUS_ONLY })} />);
    expect(screen.getByText("Unprocessed")).toBeInTheDocument();
  });

  it("shows Ready to Post once a GL account is assigned — not Posted", () => {
    const classified = { ...txn(1), suggestedGlAccount: "3030", postedFlag: false, reconciliationId: null };
    render(<TransactionGrid {...baseGridProps({ transactions: [classified], columnVisibility: POSTING_STATUS_ONLY })} />);
    expect(screen.getByText("Ready to Post")).toBeInTheDocument();
    expect(screen.queryByText("Posted")).not.toBeInTheDocument();
  });

  it("shows Posted only once the posting engine has flagged it", () => {
    const posted = { ...txn(1), suggestedGlAccount: "3030", postedFlag: true, journalId: 900, reconciliationId: null };
    render(<TransactionGrid {...baseGridProps({ transactions: [posted], columnVisibility: POSTING_STATUS_ONLY })} />);
    expect(screen.getByText("Posted")).toBeInTheDocument();
  });

  it("shows Reconciled, distinctly from Posted", () => {
    const reconciled = { ...txn(1), suggestedGlAccount: "3030", postedFlag: true, journalId: 900, reconciliationId: 7 };
    render(<TransactionGrid {...baseGridProps({ transactions: [reconciled], columnVisibility: POSTING_STATUS_ONLY })} />);
    expect(screen.getByText("Reconciled")).toBeInTheDocument();
    expect(screen.queryByText("Posted")).not.toBeInTheDocument();
  });
});
