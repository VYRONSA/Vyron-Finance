"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnSizingState, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { TransactionGrid, blockedEditExplanation, ruleActionsFor, ruleTypeFor, type AllocateRowPayload, type BlockedPendingEdit, type BulkSaveSummary, type TransactionGridHandle } from "./transaction-grid";
import { TransactionFiltersBar, EMPTY_FILTER_DRAFT, type FilterDraft } from "./transaction-filters-bar";
import { TransactionColumnChooser } from "./transaction-column-chooser";
import { TransactionBulkActionBar, type MatchType, type RuleCreationOptions } from "./transaction-bulk-action-bar";
import { TransactionDetailPanel } from "./transaction-detail-panel";
import { MerchantIntelligencePanel } from "./merchant-intelligence-panel";
import { SplitTransactionForm } from "@/components/financial/matching/split-transaction-form";
import { AddTransactionForm } from "./add-transaction-form";
import { ConfirmActionRow } from "@/components/ui/confirm-action";
import { IconChevronLeft } from "@/components/ui/icons";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { countsAsAllocated, transactionPostingStatus, type BankTransactionRecord, type Supplier, type TransactionDetail } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import { MOCK_TRANSACTIONS, MOCK_TRANSACTION_DETAILS } from "@/lib/mock/transaction-explorer-data";
import { ModalPortal } from "@/components/ui/modal-portal";
import { UpdateAllocatedButton } from "./update-allocated-button";

const PAGE_SIZE = 50;

/** Phase 29A — forensic review finding: this optimistic local-state
 * patch (used by the inline grid's `allocateRowInline`/`allocateRowsInline`
 * so a fast keyboard "tab through the statement" flow never needs a full
 * page refetch after every row) had drifted out of sync with the Phase 29
 * server-side fix to `bulkAssignGl`/`bulkAssignSupplier`/`bulkAssignCustomer`
 * (which now also write `allocation_method: 'Manual'`, not just
 * `is_manual_override`/`allocation_status`). Without `allocationMethod`
 * here too, a transaction AI had suggested would still locally read
 * `allocationMethod: "Future AI"` immediately after Save/Accept — since
 * `needsAiAcceptAction` gates on that exact field, the Accept button
 * would incorrectly keep showing for the rest of the browser session,
 * only correcting itself on the next full page load (when real,
 * server-fetched data replaced this patch). Always safe to set
 * unconditionally here — this function is called ONLY from a full G/C/S
 * row commit (never a VAT-only/Merchant-only edit, which use a separate,
 * always-refetching path — see `runBulkAction`), so it always represents
 * a genuine allocation-target confirmation. */
/** Phase 43 — production defect investigation found `fetchPage` (the
 * transaction list's own fetch, the highest-traffic request on this
 * page) had no request cancellation at all: a slow, stale response
 * (e.g. from a filter the user already changed away from) could resolve
 * AFTER a newer one and silently overwrite its correct results — a real
 * race, not hypothetical, on rapid filter/sort/page changes — and an
 * abandoned request was never actually cancelled at the network level,
 * so it kept holding a real browser connection open indefinitely.
 *
 * This is the exact race-prevention decision `fetchPage` needs,
 * extracted as two small, pure(-ish) functions so the LOGIC itself is
 * directly unit-testable without rendering the full page — which
 * crashes the jsdom test worker (see `transaction-explorer.test.tsx`'s
 * own comment for why), the SAME constraint `transaction-grid.tsx`'s own
 * `buildAccountCodeOptions` already exists to work around, via the same
 * "extract the pure decision, test that directly" pattern. */
export function beginTrackedFetch(ref: { current: AbortController | null }): AbortController {
  // Abort whatever THIS SAME fetch is still waiting on before starting a
  // new one — never two in-flight requests from the same call site at
  // once.
  ref.current?.abort();
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}

/** True only for the MOST RECENTLY started fetch — a stale one (aborted,
 * or simply superseded before it resolved) must never apply its result
 * or flip `loading` back to false on top of a newer request that's still
 * genuinely in flight. */
export function isCurrentFetch(ref: { current: AbortController | null }, controller: AbortController): boolean {
  return ref.current === controller;
}

export function applyAllocationPatch(t: BankTransactionRecord, input: AllocateRowPayload): BankTransactionRecord {
  // Phase 31B — `type: null` means this commit made NO allocation change
  // (a description/notes/VAT-only fix on a row that stays Unallocated) —
  // the allocation-status fields below must stay exactly as they already
  // were, never flipped to "Allocated" just because SOMETHING on the row
  // was saved.
  const isAllocationChange = input.type !== null;
  return {
    ...t,
    allocationType: isAllocationChange ? input.type : t.allocationType,
    allocationNotes: input.allocationNotes,
    // Phase 31A — `null` means "the commit didn't change the description"
    // (see `computeDescriptionUpdate`) — keep the existing local value in
    // that case, same "only patch what actually changed" reasoning every
    // other field here already follows.
    description: input.description ?? t.description,
    suggestedGlAccount: input.type === "G" ? input.accountCode : t.suggestedGlAccount,
    suggestedVatCode: input.vatCode ?? t.suggestedVatCode,
    matchedSupplierId: input.type === "S" ? input.supplierId : t.matchedSupplierId,
    matchedCustomerId: input.type === "C" ? input.customerId : t.matchedCustomerId,
    allocationStatus: isAllocationChange ? ("Allocated" as const) : t.allocationStatus,
    allocationMethod: isAllocationChange ? "Manual" : t.allocationMethod,
    isManualOverride: isAllocationChange ? true : t.isManualOverride,
  };
}

export type DuplicateRuleInfo = {
  id: number;
  name: string;
  conditions: { field: string; operator: string; value: string }[];
  actions: { actionType: string; targetId: number | null; targetText: string | null }[];
};

const DUPLICATE_RULE_FIELD_LABELS: Record<string, string> = { description: "Description", beneficiary: "Beneficiary" };
const DUPLICATE_RULE_OPERATOR_LABELS: Record<string, string> = { contains: "contains", equals: "equals", starts_with: "starts with", ends_with: "ends with", regex: "matches" };

function describeDuplicateRuleAction(
  action: { actionType: string; targetId: number | null; targetText: string | null },
  suppliers: Supplier[],
  customers: { id: number; name: string }[],
  merchants: Merchant[],
): string {
  switch (action.actionType) {
    case "set_supplier":
      return `Supplier: ${suppliers.find((s) => s.id === action.targetId)?.name ?? `#${action.targetId}`}`;
    case "set_customer":
      return `Customer: ${customers.find((c) => c.id === action.targetId)?.name ?? `#${action.targetId}`}`;
    case "set_merchant":
      return `Merchant: ${merchants.find((m) => m.id === action.targetId)?.name ?? `#${action.targetId}`}`;
    case "set_gl_account":
      return `GL Account: ${action.targetText}`;
    case "set_vat_code":
      return `VAT: ${action.targetText}`;
    default:
      return action.actionType;
  }
}

/** Phase 41, Part 2 — the exact "STOP and explain" message shown when
 * the server refuses to create a duplicate rule. Pure and exported (same
 * convention as `applyAllocationPatch` above) so the message content is
 * directly unit-testable without a network mock. Resolves Supplier/
 * Customer/Merchant target ids to real names using data already loaded
 * on this page — no second lookup needed. */
export function formatDuplicateRuleMessage(rule: DuplicateRuleInfo, suppliers: Supplier[], customers: { id: number; name: string }[], merchants: Merchant[]): string {
  const conditionsText = rule.conditions
    .map((c) => `${DUPLICATE_RULE_FIELD_LABELS[c.field] ?? c.field} ${DUPLICATE_RULE_OPERATOR_LABELS[c.operator] ?? c.operator} "${c.value}"`)
    .join(" AND ");
  const actionsText = rule.actions.map((a) => `→ ${describeDuplicateRuleAction(a, suppliers, customers, merchants)}`).join(", ");
  return `Duplicate Banking Rule — an identical active rule already exists. ${conditionsText} ${actionsText} (Existing Rule: #${rule.id}). The new rule was not created.`;
}

function matchesMockFilters(t: BankTransactionRecord, filters: FilterDraft): boolean {
  if (filters.search) {
    const term = filters.search.toLowerCase();
    const haystack = `${t.description} ${t.reference} ${t.beneficiary} ${t.notes}`.toLowerCase();
    if (!haystack.includes(term)) return false;
  }
  if (filters.dateFrom && (t.transactionDate ?? "") < filters.dateFrom) return false;
  if (filters.dateTo && (t.transactionDate ?? "") > filters.dateTo) return false;
  const amount = Math.max(t.debit, t.credit);
  if (filters.minAmount !== null && amount < filters.minAmount) return false;
  if (filters.maxAmount !== null && amount > filters.maxAmount) return false;
  if (filters.statuses && !filters.statuses.includes(t.allocationStatus)) return false;
  if (filters.bankAccountId !== null && t.bankAccountId !== filters.bankAccountId) return false;
  if (filters.duplicateOnly && t.requiredAction !== "Review — possible duplicate payment") return false;
  if (filters.unknownSupplierOnly && t.matchedSupplierId !== null) return false;
  if (filters.allocationMethods && filters.allocationMethods.length > 0 && (t.allocationMethod === null || !filters.allocationMethods.includes(t.allocationMethod))) return false;
  // Bank Accounting Posting — preview mode's local mirror of the server
  // filter, deriving the state from the same shared
  // `transactionPostingStatus` function the server and the grid badge
  // use, never a second definition of what "Posted" means.
  if (filters.postingStatuses && filters.postingStatuses.length > 0 && !filters.postingStatuses.includes(transactionPostingStatus(t))) return false;
  return true;
}

function sortMock(transactions: BankTransactionRecord[], sorting: SortingState): BankTransactionRecord[] {
  if (sorting.length === 0) return transactions;
  const { id, desc } = sorting[0];
  const sorted = [...transactions].sort((a, b) => {
    const av = id === "transactionDate" ? (a.transactionDate ?? "") : id === "debit" ? a.debit : id === "credit" ? a.credit : "";
    const bv = id === "transactionDate" ? (b.transactionDate ?? "") : id === "debit" ? b.debit : id === "credit" ? b.credit : "";
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return desc ? sorted.reverse() : sorted;
}

/**
 * "Update Allocated" — the toolbar's primary commit action.
 *
 * A PENDING allocation is one the accountant has changed in the Explorer
 * but not yet written to the database — precisely the grid's own
 * `pendingEdits` keys, which it already reports upward. This is
 * deliberately NOT "every Ready to Post transaction in the database":
 * only the user's actual uncommitted edits are ever submitted, whether
 * or not their rows happen to be selected.
 */
export function pendingAllocationIds(dirtyIds: Set<number>): number[] {
  return [...dirtyIds];
}

/** Never a bare "Success": a partial failure must read as a partial
 * failure, with the failed rows still listed underneath — and a run that
 * saved NOTHING must never read as a success either.
 *
 * PRODUCTION DEFECT this closes: with `saved: 0, failed: []` (every
 * submitted row turned out to have nothing the grid would write) this
 * previously rendered the green tick and "0 allocations updated
 * successfully." An accountant reasonably reads that as "it worked" —
 * while the pending count sits unchanged and the same click can be
 * repeated forever. Zero saved is now stated as zero saved. */
export function summarizeAllocationUpdate(summary: BulkSaveSummary): string {
  const { saved, unchanged, failed } = summary;
  if (failed.length > 0) return `${saved} updated · ${failed.length} failed`;
  if (saved === 0) {
    return unchanged > 0
      ? `Nothing was updated — ${unchanged} transaction${unchanged === 1 ? " was" : "s were"} already up to date.`
      : "Nothing was updated — there were no changes to save.";
  }
  return `${saved} allocation${saved === 1 ? "" : "s"} updated successfully.`;
}

/** The toolbar's tick/cross: only an actual write is a success. */
export function allocationUpdateSucceeded(summary: BulkSaveSummary): boolean {
  return summary.failed.length === 0 && summary.saved > 0;
}

export function TransactionExplorer({
  companyId,
  previewMode,
  bankAccounts,
  suppliers,
  customers,
  merchants,
  chartOfAccounts: initialChartOfAccounts,
  vatTreatments,
  initialTransactions,
  initialNextCursor,
  initialHasMore,
  initialImportBatch,
}: {
  companyId: string;
  previewMode: boolean;
  bankAccounts: { id: number; accountName: string }[];
  suppliers: Supplier[];
  customers: { id: number; name: string; customerCode: string }[];
  merchants: Merchant[];
  chartOfAccounts: ChartOfAccount[];
  vatTreatments: VatTreatment[];
  initialTransactions: BankTransactionRecord[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
  initialImportBatch: string | null;
}) {
  const router = useRouter();
  // Master Implementation Tracker — Programme 2, Epic E2, Finding #025.
  // A deep-linked import-batch scope used to live only in the read-only
  // badge below, dropped by the next paginate/sort/filter action since
  // it was never part of the real `filters` state driving `fetchPage`.
  const [filters, setFilters] = useState<FilterDraft>({ ...EMPTY_FILTER_DRAFT, importBatch: initialImportBatch });
  const [sorting, setSorting] = useState<SortingState>([{ id: "transactionDate", desc: true }]);
  // Transaction Explorer Redesign — "this is an allocation screen, not
  // a transaction report; prioritise editable allocation columns."
  // Hidden by default (still selectable via the column chooser, never
  // removed): the old read-only GL Account/VAT Treatment/Customer/
  // Supplier columns (redundant with the new editable Account Code/VAT
  // Code columns), plus Reference/Bank Account/Merchant/Rule Applied/
  // Journal Status/Confidence/Recovery Status — genuinely useful for
  // audit/investigation, but not needed to process a statement, and
  // trimming them is also most of what keeps the grid's natural width
  // inside a laptop screen without horizontal scrolling at all for the
  // core Date → Type → Account → VAT → Notes → Set Rule workflow.
  // UX-019 — "the eye should move Description → Type → Account Code →
  // Account Description → VAT → Notes → Set Rule → Status, no
  // unnecessary columns interrupting that flow." `balance` (a running
  // account balance, useful for bank reconciliation but not for
  // deciding how to allocate a single transaction) is the one addition
  // this round — Debit/Credit stay visible since the amount itself is
  // exactly what an accountant needs to judge the right GL account.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    glAccount: false, vatTreatment: false, customer: false, supplier: false,
    reference: false, bankAccount: false, merchant: false, balance: false, sourceGlAccount: false,
    rulesApplied: false, journalStatus: false, confidenceScore: false, requiredAction: false,
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Seeded from the server's own first fetch — no client mount-effect
  // fetch needed; every fetch after this one is triggered directly by the
  // event that changed the query (filter apply, sort click, pagination,
  // bulk action), never reactively.
  const [transactions, setTransactions] = useState<BankTransactionRecord[]>(initialTransactions);
  // Phase 44 — production defect: creating a GL account from the "+ Add
  // General Ledger Account" combobox option used to call `router.refresh()`
  // to make it visible, forcing this page's server component to re-run all
  // 7 of its sequential data loads AND re-fetch/re-serialize/re-reconcile
  // the entire (often hundreds-of-rows) `transactions` list just to add
  // ONE row to a ~76-item master-data list. That full-tree reconcile is
  // exactly what produced the reported browser "Page Unresponsive" hang —
  // reproduced live, not assumed. `chartOfAccounts` gets the same
  // client-owned-state treatment `transactions` already has: seeded once
  // from the server prop, updated locally and instantly when a new account
  // is created, no page-level refresh required.
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>(initialChartOfAccounts);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 43 — deliberately SEPARATE from the generic `error` banner
  // above: `error` also carries failures from bulk actions, rule
  // creation, etc., unrelated to whether the transaction LIST itself
  // loaded. Conflating them would mean an unrelated "couldn't assign
  // supplier" failure incorrectly renders the grid body as "list failed
  // to load," or a genuine list-load failure gets stuck as an easy-to-miss
  // banner instead of the grid body's own explicit state. This is the
  // one state `TransactionGrid` reads to distinguish "loading" / "failed
  // to load, retry" / "genuinely zero results" — three states that were
  // previously conflated into two (`loading` and `rowCount === 0`),
  // meaning a failed fetch rendered identically to a real empty result.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [merchantPanelTransaction, setMerchantPanelTransaction] = useState<BankTransactionRecord | null>(null);
  // Master Implementation Tracker — Programme 2, Epic E2, Finding #085.
  const [splittingTransaction, setSplittingTransaction] = useState<BankTransactionRecord | null>(null);
  const splitPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(Boolean(splittingTransaction), splitPanelRef);
  useEffect(() => {
    if (!splittingTransaction) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSplittingTransaction(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [splittingTransaction]);
  // Phase 39 — "+ Add Transaction." Same side-panel convention as
  // `splittingTransaction` immediately above (focus trap, Escape-to-close,
  // backdrop click), not a new modal pattern.
  const [addingTransaction, setAddingTransaction] = useState(false);
  const addTransactionPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(addingTransaction, addTransactionPanelRef);
  useEffect(() => {
    if (!addingTransaction) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAddingTransaction(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [addingTransaction]);
  const [notice, setNotice] = useState<string | null>(null);
  // Master Implementation Tracker — Programme 2, Epic E2, Finding #028.
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [repeatedAllocationPrompt, setRepeatedAllocationPrompt] = useState<{
    transaction: BankTransactionRecord;
    ruleType: "GL" | "Customer" | "Supplier";
    actions: { actionType: string; targetId?: number; targetText?: string }[];
    count: number;
  } | null>(null);
  // Phase 51 — "Apply to Remaining Transactions" no longer sweeps
  // immediately; this holds the just-created rule's id/name and the
  // read-only matching count until the accountant explicitly confirms
  // (or cancels) applying it to existing transactions. See
  // `createRuleFromAllocation`/`confirmApplyRuleCompanyWide` above.
  const [pendingRuleApply, setPendingRuleApply] = useState<{ ruleId: number; ruleName: string; excludeTransactionId: number; eligibleCount: number } | null>(null);
  const [applyingRule, setApplyingRule] = useState(false);
  // Master Implementation Tracker — Epic E11, Finding #224 (RC-9). A
  // filter/sort/page change refetches `transactions` wholesale — without
  // this guard, a touched-but-incomplete allocation on the current page
  // would silently scroll out of existence with no warning.
  const [pendingEditCount, setPendingEditCount] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  // Phase 31 — "Save Selected." The grid reports its own `pendingEdits`
  // up on every change, split into the edits it will actually commit and
  // the ones it refuses, so this component can size and enable its save
  // actions without lifting `pendingEdits` out of the grid — that state,
  // and the write path that clears it, must stay exactly where individual
  // Save/Accept already correctly maintain it.
  //
  // The split is the fix for a reported production defect: "Update
  // Allocated" counted every pending edit, including ones
  // `computeCommitEligibility` refuses outright. Committing one of those
  // is a guaranteed no-op that leaves the row in `pendingEdits`, so the
  // count never moved and the button could be clicked over and over with
  // nothing changing. A count of work that cannot be done is not a count
  // of pending work — `blockedEdits` states it separately, with a reason
  // and a way to clear it.
  //
  // `pendingEditCount` above stays the TOTAL (committable or not): the
  // unsaved-changes navigation guard must still warn about an edit that
  // would be discarded, whether or not it could have been saved.
  //
  // `gridRef` is how a toolbar click actually reaches the grid's own
  // `saveSelected` (see `TransactionGridHandle`) — a normal
  // `useImperativeHandle` bridge, not a second save mechanism.
  const [committableIds, setCommittableIds] = useState<Set<number>>(new Set());
  const [blockedEdits, setBlockedEdits] = useState<BlockedPendingEdit[]>([]);
  // Phase 46 — CONFIRMED root cause of the repeated production freeze: this
  // was previously an inline arrow function created fresh on every render
  // (`onPendingEditsChange={(count, ids) => {...}}`), passed straight into
  // `TransactionGrid`'s `useEffect(() => onPendingEditsChange?.(...), [pendingEdits,
  // onPendingEditsChange])`. A new function identity every render meant
  // that effect's dependency array changed on every render too, so it ran
  // again on every commit — calling this with `new Set(pendingEdits.keys())`,
  // a BRAND NEW Set object regardless of whether its contents actually
  // changed. `setDirtyIds` can never bail out on a new object reference
  // (React's setState equality check is `Object.is`, not deep equality),
  // so every single call forced this component to re-render — which
  // recreated the inline handler again, re-triggering the child's effect,
  // forever. No user interaction was required to sustain this: it started
  // on mount and ran continuously, competing for the main thread with
  // every other render in the grid (including per-row `accountDescriptionFor`
  // lookups over `chartOfAccounts`/`suppliers`/`customers` — see that
  // function's own doc comment in transaction-grid.tsx) for as long as the
  // page stayed open. That fully explains why the freeze scaled with
  // dataset size (908+ live transactions vs. the original 181-row test
  // set) and why it never recovered on its own — an infinite loop has no
  // natural endpoint, unlike the one-time expensive `router.refresh()`
  // reconciles Phases 44-45 removed, which were real but separate defects.
  // `useCallback` with an empty dependency array gives this handler a
  // STABLE identity across renders (safe here: `setPendingEditCount`/
  // `setDirtyIds` are `useState` setters, themselves guaranteed stable) —
  // the child's effect then only re-runs when `pendingEdits` itself
  // actually changes (a real edit), never merely because its parent
  // re-rendered.
  const handlePendingEditsChange = useCallback(
    (count: number, _ids: Set<number>, triage: { committableIds: Set<number>; blocked: BlockedPendingEdit[] }) => {
      setPendingEditCount(count);
      setCommittableIds(triage.committableIds);
      setBlockedEdits(triage.blocked);
    },
    [],
  );
  const [savingSelected, setSavingSelected] = useState(false);
  const [bulkSaveResult, setBulkSaveResult] = useState<BulkSaveSummary | null>(null);
  const gridRef = useRef<TransactionGridHandle>(null);
  // Phase 43 — production defect investigation found ZERO AbortController/
  // timeout usage across every fetch in Transaction Explorer (23+ call
  // sites). Two concrete problems that follows from: (1) a slow/stale
  // request can resolve AFTER a newer one and stomp its results — a real
  // race, not hypothetical, whenever filters/sort/pagination change in
  // quick succession; (2) an abandoned request is never actually
  // cancelled at the network level, so it keeps holding a real browser
  // connection to the origin indefinitely. This ref lets `fetchPage`
  // abort its own previous in-flight call before starting a new one —
  // the single highest-traffic fetch on this page (every filter/sort/
  // page change goes through it).
  const fetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // Abort whatever's in flight when the component itself unmounts
    // (navigating away) — never leave a request from a page the user
    // already left still holding a connection open. Deliberately reads
    // `.current` fresh inside the cleanup closure, NOT a value captured
    // at mount time: the linter's suggested "copy to a variable" fix is
    // for DOM-node refs (which React nulls out before cleanup runs) —
    // this ref is a plain mutable value `fetchPage`'s own
    // `beginTrackedFetch` keeps current across the whole component's
    // life, and capturing it at mount (before any fetch has even
    // started) would abort `null` instead of whatever's actually
    // in-flight at unmount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => fetchAbortRef.current?.abort();
  }, []);

  function withUnsavedEditsGuard(action: () => void) {
    if (pendingEditCount > 0) {
      setPendingNavigation(() => action);
    } else {
      action();
    }
  }

  const buildQuery = useCallback(
    (cursor: string | null, filtersArg: FilterDraft, sortingArg: SortingState) => {
      const params = new URLSearchParams();
      if (filtersArg.search) params.set("search", filtersArg.search);
      if (filtersArg.dateFrom) params.set("dateFrom", filtersArg.dateFrom);
      if (filtersArg.dateTo) params.set("dateTo", filtersArg.dateTo);
      if (filtersArg.minAmount !== null) params.set("minAmount", String(filtersArg.minAmount));
      if (filtersArg.maxAmount !== null) params.set("maxAmount", String(filtersArg.maxAmount));
      for (const s of filtersArg.statuses ?? []) params.append("status", s);
      if (filtersArg.bankAccountId !== null) params.set("bankAccountId", String(filtersArg.bankAccountId));
      if (filtersArg.importBatch) params.set("importBatch", filtersArg.importBatch);
      if (filtersArg.duplicateOnly) params.set("duplicateOnly", "true");
      if (filtersArg.unknownSupplierOnly) params.set("unknownSupplierOnly", "true");
      for (const m of filtersArg.allocationMethods ?? []) params.append("allocationMethod", m);
      for (const p of filtersArg.postingStatuses ?? []) params.append("postingStatus", p);
      if (sortingArg[0]) {
        params.set("sortBy", sortingArg[0].id);
        params.set("sortDirection", sortingArg[0].desc ? "desc" : "asc");
      }
      params.set("pageSize", String(PAGE_SIZE));
      if (cursor) params.set("cursor", cursor);
      return params.toString();
    },
    [],
  );

  const fetchPage = useCallback(
    async (cursor: string | null, filtersArg: FilterDraft, sortingArg: SortingState) => {
      if (previewMode) {
        const filtered = sortMock(MOCK_TRANSACTIONS.filter((t) => matchesMockFilters(t, filtersArg)), sortingArg);
        setTransactions(filtered);
        setHasMore(false);
        setNextCursor(null);
        return;
      }
      const controller = beginTrackedFetch(fetchAbortRef);

      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch(`/api/companies/${companyId}/transactions?${buildQuery(cursor, filtersArg, sortingArg)}`, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) {
          setFetchError(body.error ?? `Request failed (${res.status})`);
          return;
        }
        setTransactions(body.transactions);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } catch (err) {
        // An abort is THIS code intentionally cancelling its own earlier
        // request — never a real failure, so it must never surface as
        // one (no misleading error banner for a request we ourselves cut
        // off, and no `setLoading(false)` racing a still-active newer
        // request's own `finally` below).
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFetchError("Couldn't reach the API. Check your connection and try again.");
      } finally {
        if (isCurrentFetch(fetchAbortRef, controller)) setLoading(false);
      }
    },
    [previewMode, companyId, buildQuery],
  );

  // Phase 43 — Retry re-issues the EXACT same request that just failed
  // (same cursor/filters/sorting), never silently resetting the view
  // back to page 1 or clearing an active filter the accountant chose.
  function retryFetch() {
    fetchPage(cursorStack[cursorIndex], filters, sorting);
  }

  function applyFilters(draft: FilterDraft) {
    withUnsavedEditsGuard(() => {
      // Finding #025 — `TransactionFiltersBar` has no input for
      // `importBatch` (it's a deep-link concept, not a user-set filter),
      // so its own draft always reports `importBatch: null`; preserve
      // whatever scope is already active rather than letting an
      // unrelated "Apply" click silently drop it.
      const next = { ...draft, importBatch: filters.importBatch };
      setFilters(next);
      setCursorStack([null]);
      setCursorIndex(0);
      setRowSelection({});
      fetchPage(null, next, sorting);
    });
  }

  function applySorting(updater: SortingState | ((old: SortingState) => SortingState)) {
    withUnsavedEditsGuard(() => {
      const nextSorting = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(nextSorting);
      setCursorStack([null]);
      setCursorIndex(0);
      setRowSelection({});
      fetchPage(null, filters, nextSorting);
    });
  }

  function goNext() {
    if (!nextCursor) return;
    withUnsavedEditsGuard(() => {
      const newStack = [...cursorStack.slice(0, cursorIndex + 1), nextCursor];
      setCursorStack(newStack);
      setCursorIndex(newStack.length - 1);
      fetchPage(nextCursor, filters, sorting);
    });
  }

  function goPrevious() {
    if (cursorIndex === 0) return;
    withUnsavedEditsGuard(() => {
      const newIndex = cursorIndex - 1;
      setCursorIndex(newIndex);
      fetchPage(cursorStack[newIndex], filters, sorting);
    });
  }

  /** Pilot Review Board follow-up — "at the top of Transaction Explorer,
   * display live-updating allocation statistics." Deliberately scoped to
   * the current page/filtered set (`transactions`, which already updates
   * in place as `allocateRowInline` commits rows — no refetch needed for
   * it to stay live) rather than the whole company: a genuinely
   * company-wide live count would mean re-querying the aggregate after
   * every single-row commit, which is exactly the full-page-refetch cost
   * `allocateRowInline`'s own design note explains this redesign exists
   * to avoid. Phase 26A removed the page-level `ExecutiveSummaryBar`
   * (Transaction Explorer's own company-wide summary) that used to sit
   * above this component — this inline, page-scoped stats row is the
   * only summary Transaction Explorer shows now, so "this page" no
   * longer needs to be read against a second, company-wide number. */
  const pageStats = useMemo(() => {
    let allocated = 0;
    let needsReview = 0;
    let rulesCreated = 0;
    let duplicates = 0;
    // Bank Accounting Posting — the workflow states, counted alongside
    // the allocation states rather than instead of them: "Allocated"
    // says a transaction has been told where it belongs, "Posted" says
    // it has actually entered the General Ledger, and an accountant
    // needs both numbers to know what is left to do.
    //
    // They do NOT overlap: a posted transaction leaves the Allocated
    // count entirely (`countsAsAllocated`), so these numbers partition
    // the page instead of double-counting the rows that are already in
    // the ledger.
    const posting = { Unprocessed: 0, "Ready to Post": 0, Posted: 0, Reconciled: 0 };
    for (const t of transactions) {
      if (t.requiredAction === REQUIRED_ACTION_DUPLICATE_PAYMENT) duplicates++;
      else if (t.requiredAction) needsReview++;
      if (t.ruleId !== null || t.rulesTriggered.length > 0) rulesCreated++;
      if (countsAsAllocated(t)) allocated++;
      posting[transactionPostingStatus(t)]++;
    }
    return { imported: transactions.length, allocated, needsReview, rulesCreated, duplicates, posting };
  }, [transactions]);

  const selectedTransactions = useMemo(
    () => transactions.filter((t) => rowSelection[String(t.id)]),
    [transactions, rowSelection],
  );
  const selectedIds = useMemo(() => selectedTransactions.map((t) => t.id), [selectedTransactions]);
  // Phase 31 — "Save Selected" must only be enabled when at least one
  // SELECTED row is dirty, not merely when something is selected (most
  // selections have zero unsaved edits) or when something anywhere on the
  // page is dirty (an edited row the user never selected must not count).
  // Committable, not merely dirty — same reasoning as "Update Allocated":
  // enabling a save button on edits the grid would refuse produces a click
  // that reports failures and changes nothing.
  const dirtySelectedCount = useMemo(() => selectedIds.filter((id) => committableIds.has(id)).length, [selectedIds, committableIds]);

  /** Phase 31 — "Save Selected." Delegates the actual per-row saving to
   * the grid's own `saveSelected` (via `gridRef`) — this function's only
   * job is orchestrating the click: prevent a duplicate submission while
   * one is already running, and surface whatever summary comes back the
   * same way every other bulk result already surfaces here (`notice`
   * banner precedent), not a bare "Success." */
  async function handleSaveSelected() {
    if (savingSelected || previewMode) return;
    setSavingSelected(true);
    setBulkSaveResult(null);
    try {
      const summary = await gridRef.current?.saveSelected(selectedIds);
      if (summary) setBulkSaveResult(summary);
    } finally {
      setSavingSelected(false);
    }
  }

  /**
   * "Update Allocated" — commits EVERY pending allocation edit on the
   * page, not only the rows that happen to be selected. Transaction
   * Explorer is a bulk workspace: an accountant allocates many rows and
   * then commits them together, so committing has to be reachable
   * without first re-selecting what they just edited.
   *
   * It reuses the identical write path a single row already uses — the
   * grid's `saveSelected` -> `commitRow` -> `allocate-row` endpoint ->
   * `allocateRow` -> `bulkUpdateWithAllocationHistory`. No second
   * allocation architecture, and therefore every existing guard still
   * applies unchanged: posted transactions are refused by the
   * repository's own `journal_id IS NULL` claim, review holds
   * (migration 0094) stand, `ae_allocation_history` is still written,
   * and nothing here creates a journal, GL entry or posting batch.
   * Allocating is not posting.
   *
   * Rows that fail stay dirty (see `commitRow`), so a partial failure
   * never silently drops the accountant's work.
   */
  async function commitPendingAllocations(): Promise<BulkSaveSummary | null> {
    if (savingSelected || previewMode) return null;
    // Only edits the grid will actually accept — submitting a refusable
    // one is a guaranteed no-op that leaves the count exactly where it was.
    const ids = pendingAllocationIds(committableIds);
    if (ids.length === 0) return null;
    setSavingSelected(true);
    setBulkSaveResult(null);
    try {
      const summary = (await gridRef.current?.saveSelected(ids)) ?? null;
      if (summary) setBulkSaveResult(summary);
      // Refresh the affected rows so the committed allocation — and the
      // Posting Status derived from it — is what the grid, and the posting
      // preflight that runs next, actually see. Rows that failed remain in
      // `pendingEdits` (they are still on this page, so `prunePendingEdits`
      // keeps them) and stay editable.
      await fetchPage(cursorStack[cursorIndex], filters, sorting);
      return summary;
    } finally {
      setSavingSelected(false);
    }
  }

  /** Clears the pending edits the grid refuses to commit. The accountant's
   * only alternative was cancelling each row individually — and until they
   * did, the "unsaved edits" navigation guard stayed armed over changes
   * that could never be written. Discards local edits only: it touches no
   * transaction, writes nothing, and posts nothing. */
  function discardBlockedEdits() {
    gridRef.current?.discardEdits(blockedEdits.map((b) => b.id));
  }

  /** Pilot Review Board follow-up — "Apply To Merchant / Description /
   * Same Amount / Same Reference." Expands the existing checkbox
   * selection to every row on the current page matching the single
   * selected reference row, then the existing GL/VAT/Supplier/Customer
   * bulk buttons apply to the expanded set exactly as they already do
   * for a manual multi-select — no new bulk-apply code path needed.
   * "Merchant" matches on `beneficiary` (the bank statement's own payee
   * text), not `matchedMerchantId`, since most transactions don't have
   * Merchant Coding run against them yet at allocation time. */
  async function selectSimilar(reference: BankTransactionRecord, criterion: "merchant" | "description" | "amount" | "reference") {
    const matches = transactions.filter((t) => {
      if (criterion === "merchant") return t.beneficiary === reference.beneficiary;
      if (criterion === "description") return t.description === reference.description;
      if (criterion === "amount") return Math.max(t.debit, t.credit) === Math.max(reference.debit, reference.credit);
      return reference.reference !== "" && t.reference === reference.reference;
    });
    const next: RowSelectionState = {};
    for (const t of matches) next[String(t.id)] = true;
    setRowSelection(next);

    // Master Implementation Tracker — Epic E2, Finding #086. Selection
    // itself stays page-scoped (the bulk-action bar derives `selected`
    // from the loaded `transactions` array — spanning pages would need a
    // much larger rework of that architecture, out of this finding's
    // scope), but the gap is no longer silent: tell the accountant when
    // more matches exist elsewhere in the company than were selected.
    if (previewMode) return;
    const value = criterion === "merchant" ? reference.beneficiary : criterion === "description" ? reference.description : criterion === "amount" ? String(Math.max(reference.debit, reference.credit)) : reference.reference;
    if (!value) return;
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/similar-count?criterion=${criterion}&value=${encodeURIComponent(value)}`);
      if (!res.ok) return;
      const body = await res.json();
      const totalCount: number = body.count ?? 0;
      if (totalCount > matches.length) {
        setNotice(`Selected ${matches.length} matching transaction${matches.length === 1 ? "" : "s"} on this page — ${totalCount - matches.length} more match elsewhere in the company and were not selected. Narrow your filters or search to reach them.`);
      }
    } catch {
      // best-effort disclosure only — selection itself already succeeded
    }
  }

  async function runBulkAction(body: Record<string, unknown>) {
    if (previewMode) return;
    setBulkLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json();
      if (!res.ok) {
        setError(responseBody.error ?? `Request failed (${res.status})`);
        return;
      }
      // Master Implementation Tracker — Programme 2, Epic E2, Finding
      // #215. `generate-journal`'s skip reasons (e.g. the new "Bank
      // account has no GL account configured" block) were fetched but
      // never read — a block with no visible outcome is barely better
      // than no block at all.
      const skipped: { transactionId: number; reason: string }[] = responseBody.outcome?.skipped ?? [];
      if (skipped.length > 0) {
        const reasons = [...new Set(skipped.map((s) => s.reason))];
        setNotice(`${skipped.length} transaction${skipped.length === 1 ? " was" : "s were"} skipped: ${reasons.join("; ")}`);
      }
      // Phase 39 — Delete Transaction on a mixed posted/unposted selection:
      // the unposted ones are deleted, the posted ones are reported back
      // rather than silently left out of the summary.
      const deletedIds: number[] | undefined = responseBody.deletedIds;
      const blockedIds: number[] | undefined = responseBody.blockedIds;
      if (deletedIds && blockedIds) {
        if (blockedIds.length > 0) {
          setNotice(
            `Deleted ${deletedIds.length} transaction${deletedIds.length === 1 ? "" : "s"}. ${blockedIds.length} transaction${blockedIds.length === 1 ? "" : "s"} could not be deleted — already posted to the General Ledger.`,
          );
        } else if (deletedIds.length > 0) {
          setNotice(`Deleted ${deletedIds.length} transaction${deletedIds.length === 1 ? "" : "s"}.`);
        }
      }
      setRowSelection({});
      // Phase 44 — `router.refresh()` used to run here too, immediately
      // after `fetchPage` had already refreshed the only data this action
      // actually changes (`transactions`). Deleting transactions touches no
      // master data (suppliers/customers/chartOfAccounts/etc.), so that
      // second call bought nothing beyond forcing the same expensive
      // full-page server reload + full-grid reconcile confirmed to cause
      // the reported browser hang (see the `chartOfAccounts` local-state
      // comment near the top of this component).
      await fetchPage(cursorStack[cursorIndex], filters, sorting);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setBulkLoading(false);
    }
  }

  /** Pilot Review Round 1, Phase 5+6 — "Provide ☐ Create Banking Rule"
   * during allocation; once saved, "immediately scan the remainder of
   * the imported statement and allocate every matching transaction."
   * `matchType` maps onto `ConditionOperator` (see
   * `transaction-bulk-action-bar.tsx`'s own doc comment for why
   * "Multiple Keywords" uses `regex` rather than a native OR-operator). */
  function conditionFor(matchType: MatchType, matchDescription: string): { operator: string; value: string } {
    if (matchType === "exact") return { operator: "equals", value: matchDescription };
    if (matchType === "multiple_keywords") {
      const keywords = matchDescription.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return { operator: "regex", value: `(${keywords.join("|")})` };
    }
    return { operator: matchType, value: matchDescription };
  }

  /** Phase 51 — production defect (Phase 50's forensic report): this used
   * to call "apply-rule-company-wide" immediately and silently the moment
   * a new rule was created, because `RuleCreationOptions.applyToRemaining`
   * defaulted to `true` everywhere it's constructed (this file's own
   * `repeatedAllocationPrompt` handler below, `set-rule-modal.tsx`,
   * `transaction-grid.tsx`'s `ruleOptionsForCommit` fallback, and
   * `transaction-bulk-action-bar.tsx`'s `CreateRulePanel` — all four now
   * default it to `false`). A single Save-with-Set-Rule could silently
   * reallocate an unbounded number of OTHER, untouched transactions
   * company-wide — confirmed in production via `ae_allocation_history`.
   *
   * The duplicate-rule check is unchanged (Phase 41): the server itself
   * checks BEFORE ever inserting and returns 409 — nothing new needed
   * there, this still stops here exactly as before on a duplicate.
   *
   * What's new: even when the accountant explicitly re-enables "Apply to
   * Remaining Transactions," this no longer runs the sweep itself. It
   * only creates the rule, then (if requested) fetches a read-only
   * COUNT of how many existing transactions would be affected and stores
   * it in `pendingRuleApply` — the confirmation panel rendered below in
   * this component's JSX is what actually calls `confirmApplyRuleCompanyWide`,
   * only after the accountant explicitly clicks "Apply to N Transactions." */
  async function createRuleFromAllocation(
    transaction: BankTransactionRecord,
    ruleType: "GL" | "Customer" | "Supplier",
    actions: { actionType: string; targetId?: number; targetText?: string }[],
    options: RuleCreationOptions,
  ): Promise<void> {
    const { operator, value } = conditionFor(options.matchType, options.matchDescription);
    const ruleRes = await fetch(`/api/companies/${companyId}/banking-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "Banking",
        ruleType,
        name: `Auto: ${options.matchDescription} → ${ruleType}`,
        description: "Created inline while allocating a transaction.",
        isActive: options.applyToFutureImports,
        // Phase 31B — the field the condition compares against is now the
        // ACTUAL field the accountant chose in Set Rule (or the fixed
        // "beneficiary" every non-Set-Rule caller of this function
        // already used) — never hardcoded, since a "description" rule
        // matched against "beneficiary" would never fire correctly.
        conditions: [{ field: options.matchField, operator, value }],
        actions,
      }),
    });
    const ruleBody = await ruleRes.json();
    if (!ruleRes.ok) {
      // Phase 41, Part 2/4 — the server already validated and checked
      // for a duplicate BEFORE ever inserting; on a 409 nothing was
      // created, so this STOPS here — no apply-rule-company-wide call
      // follows, exactly the "validate → check duplicate → STOP" order.
      if (ruleRes.status === 409 && ruleBody.duplicateRule) {
        setError(formatDuplicateRuleMessage(ruleBody.duplicateRule, suppliers, customers, merchants));
        return;
      }
      setError(`Allocation saved, but the Banking Rule could not be created: ${ruleBody.error ?? ruleRes.status}`);
      return;
    }

    if (!options.applyToRemaining) {
      setNotice(`Banking Rule "${ruleBody.rule.name}" created.`);
      return;
    }

    // Phase 51 — read-only count first, never the sweep itself. Phase 39's
    // own reasoning for WHY this must be company-wide (not batch-scoped)
    // still applies once the accountant actually confirms — see
    // `confirmApplyRuleCompanyWide` below.
    const previewRes = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview-apply-rule-company-wide", excludeTransactionId: transaction.id, ruleId: ruleBody.rule.id }),
    });
    const previewBody = await previewRes.json();
    if (!previewRes.ok) {
      setNotice(`Banking Rule "${ruleBody.rule.name}" created, but couldn't check how many existing transactions match it: ${previewBody.error ?? previewRes.status}`);
      return;
    }
    const preview: { matchedCount: number; eligibleCount: number; alreadyAllocatedCount: number } = previewBody.preview;
    if (preview.eligibleCount === 0) {
      setNotice(`Banking Rule "${ruleBody.rule.name}" created. No existing transactions currently match it.`);
      return;
    }
    setPendingRuleApply({ ruleId: ruleBody.rule.id, ruleName: ruleBody.rule.name, excludeTransactionId: transaction.id, eligibleCount: preview.eligibleCount });
  }

  /** Phase 51 — the ONLY place `apply-rule-company-wide` is ever called
   * from now — exclusively from the accountant explicitly clicking
   * "Apply to N Transactions" on the confirmation panel `pendingRuleApply`
   * drives (rendered in this component's JSX). */
  async function confirmApplyRuleCompanyWide(): Promise<void> {
    const pending = pendingRuleApply;
    if (!pending) return;
    setPendingRuleApply(null);
    setApplyingRule(true);
    try {
      // Phase 39 — company-wide, not batch-scoped: the accountant's own
      // "fish" transactions were sitting in a different import batch than
      // the one just allocated, so the old batch-only retroactive apply
      // never evaluated them at all. Every currently-Unallocated transaction
      // in the company is now in scope, and the result is reported with an
      // explicit breakdown rather than a single ambiguous count.
      const applyRes = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply-rule-company-wide", excludeTransactionId: pending.excludeTransactionId, ruleId: pending.ruleId }),
      });
      const applyBody = await applyRes.json();
      if (!applyRes.ok) {
        setNotice(`Banking Rule "${pending.ruleName}" created, but applying it to existing transactions failed: ${applyBody.error ?? applyRes.status}`);
        return;
      }
      const summary: { matchedCount: number; allocatedCount: number; alreadyAllocatedCount: number; rejectedCount: number; allocatedTransactionIds: number[] } = applyBody.summary;
      setHighlightedIds(new Set(summary.allocatedTransactionIds));
      setNotice(
        `Banking Rule "${pending.ruleName}" created — ${summary.matchedCount} transaction${summary.matchedCount === 1 ? "" : "s"} matched, ` +
          `${summary.allocatedCount} allocated, ${summary.alreadyAllocatedCount} already allocated, ${summary.rejectedCount} failed.`,
      );
      if (summary.allocatedCount > 0) {
        // Phase 44 — same redundant-`router.refresh()` removal as the
        // Delete Transaction path above: creating and applying a Banking
        // Rule touches no master-data list, only `transactions`, which
        // `fetchPage` already refreshes.
        await fetchPage(cursorStack[cursorIndex], filters, sorting);
      }
    } finally {
      setApplyingRule(false);
    }
  }

  /** Phase 51 — "Cancel causes zero additional changes": the rule itself
   * was already created (a separate, already-confirmed intent — see
   * `createRuleFromAllocation` above), so it stays and still applies to
   * future imports if `applyToFutureImports` was set. Cancelling THIS
   * confirmation only means "don't touch the N existing matching
   * transactions" — no sweep, nothing else changes. */
  function cancelApplyRuleCompanyWide(): void {
    setPendingRuleApply(null);
  }

  /** Pilot Review Round 1, Phase 7 — only checked when the accountant did
   * NOT already tick "Create Banking Rule" inline (that already covers
   * it); a single-transaction manual allocation is the one case this
   * applies to, since a bulk assignment isn't "the accountant noticing a
   * pattern one at a time." */
  async function checkRepeatedAllocation(
    transaction: BankTransactionRecord,
    ruleType: "GL" | "Customer" | "Supplier",
    actions: { actionType: string; targetId?: number; targetText?: string }[],
    target: { glAccount?: string; customerId?: number; supplierId?: number },
  ) {
    const params = new URLSearchParams({ transactionId: String(transaction.id), beneficiary: transaction.beneficiary });
    if (target.glAccount) params.set("glAccount", target.glAccount);
    if (target.customerId !== undefined) params.set("customerId", String(target.customerId));
    if (target.supplierId !== undefined) params.set("supplierId", String(target.supplierId));
    const res = await fetch(`/api/companies/${companyId}/transactions/repeated-allocation-check?${params.toString()}`);
    if (!res.ok) return;
    const body = await res.json();
    if (body.suggestRule) setRepeatedAllocationPrompt({ transaction, ruleType, actions, count: body.count });
  }

  /** Transaction Explorer Redesign, Phase 1 — the inline grid's per-row
   * commit. Deliberately does NOT go through `runBulkAction` (which does
   * a full `fetchPage`/`router.refresh()` after every call) — that would
   * refetch and re-render the whole page after each row, breaking the
   * "tab through a whole statement fast" keyboard workflow this redesign
   * exists for. Instead it patches the one changed transaction in place. */
  async function allocateRowInline(
    transaction: BankTransactionRecord,
    input: AllocateRowPayload,
    ruleOptions: RuleCreationOptions | null,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (previewMode) return { ok: false, error: "Not available in preview mode." };
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allocate-row", transactionIds: [transaction.id], ...input }),
      });
      const body = await res.json();
      if (!res.ok) {
        const message = body.error ?? `Request failed (${res.status})`;
        setError(message);
        return { ok: false, error: message };
      }
      setTransactions((prev) => prev.map((t) => (t.id === transaction.id ? applyAllocationPatch(t, input) : t)));

      // Phase 31B — `ruleOptions` can only be non-null when `edit.setRule`
      // was true, which requires a complete allocation (the Set Rule
      // checkbox is disabled whenever `isAllocationMissing`, and a null
      // Type always counts as missing) — so `input.type` is guaranteed
      // non-null here too. The explicit check documents that invariant
      // for the type-checker rather than asserting it away.
      if (ruleOptions && input.type !== null) {
        await createRuleFromAllocation(transaction, ruleTypeFor(input.type), ruleActionsFor(input), ruleOptions);
      }
      return { ok: true };
    } catch {
      const message = "Couldn't reach the API. Check the dev server is running.";
      setError(message);
      return { ok: false, error: message };
    }
  }

  /** Pilot Review Board follow-up — "Ctrl+Shift+A: allocate selected
   * rows" and "17 similar transactions found — apply?" Both are the
   * same operation (apply one already-entered allocation to many
   * transaction ids at once) and both reuse the exact same
   * `allocate-row` bulk endpoint `allocateRowInline` already calls —
   * only the id list and whether a rule gets created differ. Patches
   * every matching transaction locally, same reasoning as
   * `allocateRowInline`: a full refetch after a bulk apply would be
   * jarring mid-keyboard-flow. */
  async function allocateRowsInline(transactionIds: number[], input: AllocateRowPayload): Promise<boolean> {
    if (previewMode || transactionIds.length === 0) return false;
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allocate-row", transactionIds, ...input }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return false;
      }
      // Phase 31 — patch only the ids the server actually updated: a posted
      // transaction among the requested ids is now reported back via
      // `blockedIds` instead of silently included in a blanket success.
      const idSet = new Set((body.updatedIds as number[] | undefined) ?? transactionIds);
      setTransactions((prev) => prev.map((t) => (idSet.has(t.id) ? applyAllocationPatch(t, input) : t)));
      return true;
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
      return false;
    }
  }

  /** Backs the new inline grid's "Set Rule" checkbox — a non-mutating
   * check so a true duplicate renders as an inline badge before the rule
   * is ever created, not just after.
   *
   * Phase 29 — previously always hardcoded `{ field: "beneficiary",
   * operator: "contains", value: transaction.beneficiary }`, regardless
   * of what the accountant actually typed into the Set Rule modal. Now
   * takes the real `ruleOptions` and derives the condition via the SAME
   * `conditionFor` helper `createRuleFromAllocation` below already uses
   * for the real create call — one condition-derivation function, never
   * two that could drift, so the duplicate check always reflects the
   * rule that would genuinely be created. */
  async function checkDuplicateRule(
    transaction: BankTransactionRecord,
    ruleType: "GL" | "Customer" | "Supplier",
    actions: { actionType: string; targetId?: number; targetText?: string }[],
    ruleOptions: RuleCreationOptions,
  ): Promise<string | null> {
    if (previewMode) return null;
    try {
      const { operator, value } = conditionFor(ruleOptions.matchType, ruleOptions.matchDescription);
      const res = await fetch(`/api/companies/${companyId}/banking-rules/check-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "Banking",
          ruleType,
          conditions: [{ field: ruleOptions.matchField, operator, value }],
          actions,
        }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body.duplicate?.name ?? null;
    } catch {
      return null;
    }
  }

  async function openDetail(transaction: BankTransactionRecord) {
    if (previewMode) {
      setDetail(MOCK_TRANSACTION_DETAILS[transaction.id] ?? null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/${transaction.id}`);
      const body = await res.json();
      if (res.ok) setDetail(body.detail);
    } finally {
      setDetailLoading(false);
    }
  }

  function exportUrl(format: "csv" | "xlsx") {
    return `/api/companies/${companyId}/transactions/export?format=${format}&${buildQuery(null, filters, sorting)}`;
  }

  // Master Implementation Tracker — Programme 2, Epic E2, Finding #028.
  // `window.open` to a Content-Disposition: attachment URL just starts a
  // browser download with no handle back into the page — the server's
  // `X-Export-Truncated` header was set but nothing could ever read it,
  // so a truncated export looked identical to a complete one. Fetching
  // the file directly lets the response headers actually be inspected
  // before triggering the same download via an object URL.
  async function exportTransactions(format: "csv" | "xlsx") {
    setExporting(format);
    setError(null);
    try {
      const res = await fetch(exportUrl(format));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Export failed (${res.status})`);
        return;
      }
      const truncated = res.headers.get("X-Export-Truncated") === "1";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        setNotice(`This export was truncated — not every matching transaction fit within the export row limit. Narrow your filters and export again to get the rest.`);
      }
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setExporting(null);
    }
  }

  // Pilot Review Board follow-up — "Adaptive Layout: save personal
  // column layouts." Client-only (localStorage, per browser/device, not
  // synced across an accountant's machines) — loaded once after mount
  // (never during SSR, `localStorage` doesn't exist there) and saved
  // back on every change thereafter. `layoutLoaded` gates the very
  // first save so it can't immediately clobber a saved layout with the
  // pre-load defaults before they've been applied.
  const layoutStorageKey = `vyron:transaction-explorer:layout:${companyId}`;
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const layoutFileInputRef = useRef<HTMLInputElement>(null);

  // A one-time sync from an external system (localStorage) on mount —
  // exactly the case react.dev's own "You Might Not Need an Effect"
  // guidance carves out as legitimate Effect usage, not the "derived
  // from props/state, should just be computed during render" case the
  // `set-state-in-effect` rule is really guarding against. `window`/
  // `localStorage` don't exist during SSR, so this genuinely cannot run
  // during render — there's no non-Effect alternative here.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(layoutStorageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { columnVisibility?: VisibilityState; columnSizing?: ColumnSizingState; sorting?: SortingState };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (saved.columnVisibility) setColumnVisibility(saved.columnVisibility);
        if (saved.columnSizing) setColumnSizing(saved.columnSizing);
        if (saved.sorting) setSorting(saved.sorting);
      }
    } catch {
      // malformed/unavailable storage — fall back to the built-in defaults
    }
    setLayoutLoaded(true);
  }, [layoutStorageKey]);

  useEffect(() => {
    if (!layoutLoaded) return;
    try {
      localStorage.setItem(layoutStorageKey, JSON.stringify({ columnVisibility, columnSizing, sorting }));
    } catch {
      // storage unavailable/quota exceeded — layout just won't persist this time
    }
  }, [layoutLoaded, columnVisibility, columnSizing, sorting, layoutStorageKey]);

  // Master Implementation Tracker — Epic E2, Finding #199 (removed Phase
  // 45). This used to be a `setInterval(() => router.refresh(), 3 min)` to
  // keep `suppliers`/`customers`/`merchants`/`chartOfAccounts`/
  // `vatTreatments` — plain server-page props with no local `useState`
  // wrapper — from ever going stale during a long session, on the theory
  // that a full page-level refresh wouldn't disturb the client-paginated
  // `transactions` state.
  //
  // Phase 44 traced the SAME `router.refresh()` call, triggered by GL
  // account creation, to a reproduced, confirmed browser-level "Page
  // Unresponsive" hang: it forces this page's server component to re-run
  // all 7 of its sequential data loads AND fully reconcile the entire
  // (often hundreds-of-rows) transaction grid against the result — real,
  // sustained synchronous client work, not a cheap background refresh.
  // Phase 44 removed every ACTION-triggered call to it; this interval was
  // the one instance left in place as a "not the demonstrated trigger, so
  // don't touch it yet" residual risk. Phase 45 — the freeze recurred with
  // no specific user action to point to, exactly what a periodic,
  // unprompted timer firing mid-session would look like, and `chartOfAccounts`
  // no longer even benefits from it (it's local state now, seeded once —
  // see the comment on its `useState` above). Removed outright rather than
  // patched: `suppliers`/`customers`/`merchants`/`vatTreatments` going
  // briefly stale during one very long single session — the only real
  // cost — is a far smaller, rarer problem than a reproducible full-app
  // freeze recurring every few minutes for every user.

  function exportLayout() {
    const blob = new Blob([JSON.stringify({ columnVisibility, columnSizing, sorting }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transaction-explorer-layout.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importLayout(file: File) {
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text) as { columnVisibility?: VisibilityState; columnSizing?: ColumnSizingState; sorting?: SortingState };
        if (parsed.columnVisibility) setColumnVisibility(parsed.columnVisibility);
        if (parsed.columnSizing) setColumnSizing(parsed.columnSizing);
        if (parsed.sorting) setSorting(parsed.sorting);
      })
      .catch(() => setError("That file isn't a valid Transaction Explorer layout preset."));
  }

  return (
    // UX-006/UX-011 — "Processing Mode... the grid should occupy
    // roughly 85-90% of available browser height." `h-full min-h-0`
    // lets this component consume the full height `workspace-shell.tsx`'s
    // `<main>` gives its page content, instead of only its own natural
    // content height; `<TransactionGrid>` below is the one child wrapped
    // in `flex-1 min-h-0` so it's the piece that actually absorbs
    // whatever height is left after the toolbar/filters/stats rows above
    // it — everything else here keeps its natural height.
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {/* Phase 27 — Production Readiness Audit, Part 2. This was previously
       * a permanent, always-visible "This page: Imported/Allocated/Needs
       * Review/Rules Created/Duplicates" row sitting above the filters —
       * the exact bar whose page-scoped "Allocated" count, read as a
       * company-wide figure, caused the Phase 26J "Allocated 0" production
       * confusion. Its stats now live in the pagination footer at the
       * bottom (still fully present, nothing removed) so the top area is
       * just the filters — the grid, not a stats panel, is what should
       * dominate the screen on load. The import-batch-filter chip stays
       * here, not the footer, since it's active view-scope context the
       * user needs to see immediately, not a trailing stat — but only
       * takes a row at all when an import batch filter is actually
       * applied. */}
      {initialImportBatch && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-vf-info/30 bg-vf-info/8 px-2.5 py-0.5 text-vf-info">
            Import Batch <span className="font-mono font-semibold">{initialImportBatch}</span>
            <button
              type="button"
              onClick={() => router.push(`/company/${companyId}/transactions`)}
              className="font-semibold hover:underline"
              title="Show all transactions, not just this import batch"
            >
              Clear
            </button>
          </span>
        </div>
      )}

      <TransactionFiltersBar bankAccounts={bankAccounts} onApply={applyFilters} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TransactionBulkActionBar
          pendingAllocationIds={committableIds}
          onCommitPendingAllocations={commitPendingAllocations}
          summarizeSave={summarizeAllocationUpdate}
          selected={selectedTransactions}
          suppliers={suppliers}
          customers={customers}
          merchants={merchants}
          chartOfAccounts={chartOfAccounts}
          vatTreatments={vatTreatments}
          onAssignSupplier={async (supplierId, ruleOptions) => {
            const t = selectedTransactions[0];
            await runBulkAction({ action: "assign-supplier", transactionIds: selectedIds, supplierId });
            if (ruleOptions && t) await createRuleFromAllocation(t, "Supplier", [{ actionType: "set_supplier", targetId: supplierId }], ruleOptions);
            else if (!ruleOptions && t && selectedIds.length === 1) await checkRepeatedAllocation(t, "Supplier", [{ actionType: "set_supplier", targetId: supplierId }], { supplierId });
          }}
          onAssignMerchant={(merchantId) => runBulkAction({ action: "assign-merchant", transactionIds: selectedIds, merchantId })}
          onAssignCustomer={async (customerId, ruleOptions) => {
            const t = selectedTransactions[0];
            await runBulkAction({ action: "assign-customer", transactionIds: selectedIds, customerId });
            if (ruleOptions && t) await createRuleFromAllocation(t, "Customer", [{ actionType: "set_customer", targetId: customerId }], ruleOptions);
            else if (!ruleOptions && t && selectedIds.length === 1) await checkRepeatedAllocation(t, "Customer", [{ actionType: "set_customer", targetId: customerId }], { customerId });
          }}
          onAssignGl={async (glAccount, ruleOptions) => {
            const t = selectedTransactions[0];
            await runBulkAction({ action: "assign-gl", transactionIds: selectedIds, glAccount });
            if (ruleOptions && t) await createRuleFromAllocation(t, "GL", [{ actionType: "set_gl_account", targetText: glAccount }], ruleOptions);
            else if (!ruleOptions && t && selectedIds.length === 1) await checkRepeatedAllocation(t, "GL", [{ actionType: "set_gl_account", targetText: glAccount }], { glAccount });
          }}
          onAssignVat={(vatCode) => runBulkAction({ action: "assign-vat", transactionIds: selectedIds, vatCode })}
          onReview={(newStatus, note) => runBulkAction({ action: "review", transactionIds: selectedIds, newStatus, note })}
          companyId={companyId}
          onPosted={async () => {
            setRowSelection({});
            await fetchPage(cursorStack[cursorIndex], filters, sorting);
          }}
          onGenerateJournal={() => runBulkAction({ action: "generate-journal", transactionIds: selectedIds })}
          onApplyRule={() => runBulkAction({ action: "apply-rule", transactionIds: selectedIds })}
          onDeleteImport={() =>
            runBulkAction({ action: "delete-import", importType: "bank_transactions", importBatch: selectedTransactions[0]?.importBatch })
          }
          onDeleteTransactions={() => runBulkAction({ action: "delete", transactionIds: selectedIds })}
          onClassifyWithAi={() => runBulkAction({ action: "classify-with-ai", transactionIds: selectedIds })}
          onSaveSelected={handleSaveSelected}
          saveSelectedDirtyCount={dirtySelectedCount}
          savingSelected={savingSelected}
          loading={bulkLoading}
          previewMode={previewMode}
        />

        {selectedTransactions.length === 1 && (
          <div className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
            <span>Select same:</span>
            <Button variant="subtle" size="sm" onClick={() => selectSimilar(selectedTransactions[0], "merchant")}>
              Merchant
            </Button>
            <Button variant="subtle" size="sm" onClick={() => selectSimilar(selectedTransactions[0], "description")}>
              Description
            </Button>
            <Button variant="subtle" size="sm" onClick={() => selectSimilar(selectedTransactions[0], "amount")}>
              Amount
            </Button>
            <Button
              variant="subtle"
              size="sm"
              disabled={!selectedTransactions[0].reference}
              title={!selectedTransactions[0].reference ? "This transaction has no reference to match on" : undefined}
              onClick={() => selectSimilar(selectedTransactions[0], "reference")}
            >
              Reference
            </Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <UpdateAllocatedButton
            committableCount={committableIds.size}
            blockedCount={blockedEdits.length}
            saving={savingSelected}
            disabled={previewMode}
            disabledTitle={previewMode ? "Available once a production Supabase project is connected" : undefined}
            onUpdate={commitPendingAllocations}
          />
          <Button
            variant="subtle"
            size="sm"
            disabled={previewMode}
            title={previewMode ? "Available once a production Supabase project is connected" : undefined}
            onClick={() => setAddingTransaction(true)}
          >
            + Add Transaction
          </Button>
          <TransactionColumnChooser columnVisibility={columnVisibility} onChange={setColumnVisibility} />
          <Button variant="subtle" size="sm" onClick={exportLayout} title="Download your current column layout (visibility, widths, sort) as a file">
            Export Layout
          </Button>
          <input
            ref={layoutFileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importLayout(file);
              e.target.value = "";
            }}
          />
          <Button variant="subtle" size="sm" onClick={() => layoutFileInputRef.current?.click()} title="Load a previously exported layout preset">
            Import Layout
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode || exporting !== null} title={previewMode ? "Available once a production Supabase project is connected" : undefined} onClick={() => exportTransactions("csv")}>
            {exporting === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode || exporting !== null} title={previewMode ? "Available once a production Supabase project is connected" : undefined} onClick={() => exportTransactions("xlsx")}>
            {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}
      {notice && <p className="text-sm text-[#1f6e4b]">{notice}</p>}

      {/* Phase 31 — "Save Selected" result. Never a bare "Success": the
       * accountant needs the saved/failed/unchanged breakdown at a
       * glance, and — when anything failed — exactly which transaction
       * and why, so they can find and fix it without hunting through the
       * grid. Failed rows stay dirty (see `commitRow`), so nothing here
       * silently drops a change. */}
      {blockedEdits.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-vf-md border border-vf-warning/25 bg-vf-warning/8 px-3.5 py-2.5 text-sm text-[#93601f]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">
              {blockedEdits.length} pending change{blockedEdits.length === 1 ? "" : "s"} cannot be saved yet
              {committableIds.size > 0 ? ` — Update Allocated will commit the other ${committableIds.size}.` : "."}
            </span>
            <button
              type="button"
              onClick={discardBlockedEdits}
              disabled={previewMode || savingSelected}
              className="ml-auto text-xs font-medium underline underline-offset-2 hover:text-vf-ink disabled:opacity-50"
            >
              Discard {blockedEdits.length === 1 ? "it" : "them"}
            </button>
          </div>
          <ul className="flex flex-col gap-0.5 pl-1 text-xs">
            {blockedEdits.slice(0, 8).map((b) => {
              const t = transactions.find((tx) => tx.id === b.id);
              return (
                <li key={b.id}>
                  {t?.transactionDate ?? "—"} — {t?.description || t?.beneficiary || `Transaction #${b.id}`} — {blockedEditExplanation(b.reason)}
                </li>
              );
            })}
            {blockedEdits.length > 8 && <li>…and {blockedEdits.length - 8} more.</li>}
          </ul>
        </div>
      )}

      {bulkSaveResult && (
        <div className="flex flex-col gap-1.5 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt/60 px-3.5 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`font-medium ${allocationUpdateSucceeded(bulkSaveResult) ? "text-[#1f6e4b]" : "text-vf-danger"}`}>
              {allocationUpdateSucceeded(bulkSaveResult) ? "✓ " : "! "}
              {summarizeAllocationUpdate(bulkSaveResult)}
            </span>
            {bulkSaveResult.saved > 0 && bulkSaveResult.unchanged > 0 && (
              <span className="text-vf-ink-faint">— {bulkSaveResult.unchanged} unchanged</span>
            )}
            <button type="button" onClick={() => setBulkSaveResult(null)} className="ml-auto text-xs font-medium text-vf-ink-faint hover:text-vf-ink">
              Dismiss
            </button>
          </div>
          {bulkSaveResult.failed.length > 0 && (
            <ul className="flex flex-col gap-0.5 pl-1 text-xs text-vf-ink-soft">
              {bulkSaveResult.failed.map((f) => {
                const t = transactions.find((tx) => tx.id === f.id);
                return (
                  <li key={f.id}>
                    {t?.transactionDate ?? "—"} — {t?.description || t?.beneficiary || `Transaction #${f.id}`} — {f.reason}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {repeatedAllocationPrompt && (
        <div className="flex flex-wrap items-center gap-3 rounded-vf-md border border-vf-warning/25 bg-vf-warning/8 px-3.5 py-2.5 text-sm text-[#93601f]">
          <span>
            You have allocated &ldquo;{repeatedAllocationPrompt.transaction.beneficiary}&rdquo; the same way {repeatedAllocationPrompt.count} times.
            Would you like to create a Banking Rule?
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const { transaction, ruleType, actions } = repeatedAllocationPrompt;
              setRepeatedAllocationPrompt(null);
              // Phase 51 — this quick "would you like to create a rule?"
              // banner has no UI of its own to opt into "apply to
              // remaining" (see the doc comment on `createRuleFromAllocation`
              // above), so it stays off by default here same as everywhere
              // else — the rule still applies to future imports.
              await createRuleFromAllocation(transaction, ruleType, actions, {
                matchField: "beneficiary", matchDescription: transaction.beneficiary, matchType: "contains", applyToRemaining: false, applyToFutureImports: true,
              });
            }}
          >
            Create Banking Rule
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setRepeatedAllocationPrompt(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {pendingNavigation && (
        <ConfirmActionRow
          layout="panel"
          tone="danger"
          message={`You have ${pendingEditCount} unsaved allocation edit${pendingEditCount === 1 ? "" : "s"} on this page. Continue and discard ${pendingEditCount === 1 ? "it" : "them"}?`}
          confirmLabel="Discard and Continue"
          loading={false}
          onConfirm={() => {
            const action = pendingNavigation;
            setPendingNavigation(null);
            action();
          }}
          onCancel={() => setPendingNavigation(null)}
        />
      )}

      {pendingRuleApply && (
        <ConfirmActionRow
          layout="panel"
          tone="primary"
          loading={applyingRule}
          confirmLabel={`Apply to ${pendingRuleApply.eligibleCount} Transaction${pendingRuleApply.eligibleCount === 1 ? "" : "s"}`}
          confirmingLabel="Applying…"
          // Phase 51 review — the wording is deliberate: the FIRST sentence
          // states, unambiguously, that the rule already exists and is
          // already saved, before the question about existing transactions
          // is even asked — so "Cancel" reads as answering that second
          // question ("not now"), never as undoing the first.
          message={`Banking Rule "${pendingRuleApply.ruleName}" has been created and already applies to future imports. ${pendingRuleApply.eligibleCount} matching existing transaction${pendingRuleApply.eligibleCount === 1 ? "" : "s"} found — apply it to ${pendingRuleApply.eligibleCount === 1 ? "that transaction" : "those transactions"} too?`}
          itemsPreview={
            <p className="text-xs text-vf-ink-soft">
              Cancel only skips applying to these existing transactions — the rule you created is not affected and stays active for future imports.
            </p>
          }
          onConfirm={confirmApplyRuleCompanyWide}
          onCancel={cancelApplyRuleCompanyWide}
        />
      )}

      <div className="min-h-0 min-w-0 flex-1">
        <TransactionGrid
          ref={gridRef}
          transactions={transactions}
          sorting={sorting}
          onSortingChange={applySorting}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          onPendingEditsChange={handlePendingEditsChange}
          columnSizing={columnSizing}
          onColumnSizingChange={setColumnSizing}
          onRowClick={openDetail}
          loading={loading}
          error={fetchError}
          onRetry={retryFetch}
          highlightedIds={highlightedIds}
          suppliers={suppliers}
          customers={customers}
          chartOfAccounts={chartOfAccounts}
          vatTreatments={vatTreatments}
          onGlAccountCreated={(account) => setChartOfAccounts((prev) => [...prev, account])}
          onAllocateRow={allocateRowInline}
          onBulkAllocate={allocateRowsInline}
          onCheckDuplicateRule={checkDuplicateRule}
          onMerchantClick={setMerchantPanelTransaction}
          onSplitTransaction={setSplittingTransaction}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-vf-ink-faint" role="status" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <span>{pageStats.imported} transaction(s) on this page</span>
          <span>·</span>
          <span>Allocated <span className="font-mono font-semibold text-[#1f6e4b]">{pageStats.allocated}</span></span>
          <span>·</span>
          <span>Needs Review <span className="font-mono font-semibold text-orange-700">{pageStats.needsReview}</span></span>
          <span>·</span>
          <span>Rules Created <span className="font-mono font-semibold text-vf-info">{pageStats.rulesCreated}</span></span>
          <span>·</span>
          <span>Duplicates <span className="font-mono font-semibold text-vf-ink">{pageStats.duplicates}</span></span>
          <span>·</span>
          <span>Unprocessed <span className="font-mono font-semibold text-vf-ink">{pageStats.posting.Unprocessed}</span></span>
          <span>·</span>
          <span>Ready to Post <span className="font-mono font-semibold text-vf-info">{pageStats.posting["Ready to Post"]}</span></span>
          <span>·</span>
          <span>Posted <span className="font-mono font-semibold text-[#1f6e4b]">{pageStats.posting.Posted}</span></span>
          <span>·</span>
          <span>Reconciled <span className="font-mono font-semibold text-[#1f6e4b]">{pageStats.posting.Reconciled}</span></span>
        </div>
        {!previewMode && (
          <div className="flex gap-2">
            <Button variant="subtle" size="sm" disabled={cursorIndex === 0 || loading} onClick={goPrevious}>
              Previous
            </Button>
            <Button variant="subtle" size="sm" disabled={!hasMore || loading} onClick={goNext}>
              Next
            </Button>
          </div>
        )}
      </div>

      <TransactionDetailPanel
        detail={detail}
        loading={detailLoading}
        onClose={() => setDetail(null)}
        onLearnRule={() => {
          if (!detail) return;
          const params = new URLSearchParams({ prefillBeneficiary: detail.transaction.beneficiary, prefillGlAccount: detail.transaction.suggestedGlAccount ?? "" });
          router.push(`/company/${companyId}/banking-rules?${params.toString()}`);
        }}
        previewMode={previewMode}
        onAccept={async () => {
          if (!detail) return;
          await runBulkAction({ action: "review", transactionIds: [detail.transaction.id], newStatus: "Approved", note: "" });
          openDetail(detail.transaction);
        }}
        onReject={async () => {
          if (!detail) return;
          await runBulkAction({ action: "review", transactionIds: [detail.transaction.id], newStatus: "Rejected", note: "" });
          openDetail(detail.transaction);
        }}
        onClassifyWithAi={async () => {
          if (!detail) return;
          await runBulkAction({ action: "classify-with-ai", transactionIds: [detail.transaction.id] });
          openDetail(detail.transaction);
        }}
        classifying={bulkLoading}
        // The Update action reuses `allocateRowInline` — the same
        // `allocate-row` endpoint, service and repository the inline grid
        // commits through, with its posted-transaction and review-hold
        // guards intact. On success the panel is reopened and the page
        // refetched so the new allocation, and the Posting Status derived
        // from it, are immediately visible in both the panel and the grid.
        onUpdate={async (input) => {
          if (!detail) return { ok: false as const, error: "No transaction open." };
          const result = await allocateRowInline(detail.transaction, input, null);
          if (result.ok) {
            openDetail(detail.transaction);
            await fetchPage(cursorStack[cursorIndex], filters, sorting);
          }
          return result;
        }}
        chartOfAccounts={chartOfAccounts}
        vatTreatments={vatTreatments}
        suppliers={suppliers}
        customers={customers}
      />

      {merchantPanelTransaction && (
        <MerchantIntelligencePanel
          companyId={companyId}
          transaction={merchantPanelTransaction}
          merchants={merchants}
          onClose={() => setMerchantPanelTransaction(null)}
          previewMode={previewMode}
        />
      )}

      {splittingTransaction && (
        <ModalPortal>
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" aria-label="Close split transaction" className="absolute inset-0 bg-black/40" onClick={() => setSplittingTransaction(null)} />
          <div ref={splitPanelRef} role="dialog" aria-modal="true" aria-labelledby="split-transaction-heading" tabIndex={-1} className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl">
            <button type="button" onClick={() => setSplittingTransaction(null)} className="mb-4 flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
              <IconChevronLeft className="h-4 w-4" />
              Close
            </button>
            <h2 id="split-transaction-heading" className="text-lg font-semibold text-vf-ink">
              Split {splittingTransaction.description || "transaction"}
            </h2>
            <div className="mt-4">
              <SplitTransactionForm
                companyId={companyId}
                transactionId={splittingTransaction.id}
                amount={Math.max(splittingTransaction.debit, splittingTransaction.credit)}
                chartOfAccounts={chartOfAccounts}
                previewMode={previewMode}
                onDone={() => setSplittingTransaction(null)}
              />
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {addingTransaction && (
        <ModalPortal>
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" aria-label="Close add transaction" className="absolute inset-0 bg-black/40" onClick={() => setAddingTransaction(false)} />
          <div ref={addTransactionPanelRef} role="dialog" aria-modal="true" aria-labelledby="add-transaction-heading" tabIndex={-1} className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl">
            <button type="button" onClick={() => setAddingTransaction(false)} className="mb-4 flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
              <IconChevronLeft className="h-4 w-4" />
              Close
            </button>
            <h2 id="add-transaction-heading" className="text-lg font-semibold text-vf-ink">
              Add Transaction
            </h2>
            <div className="mt-4">
              <AddTransactionForm
                companyId={companyId}
                bankAccounts={bankAccounts}
                suppliers={suppliers}
                customers={customers}
                chartOfAccounts={chartOfAccounts}
                previewMode={previewMode}
                onCreated={async () => {
                  setAddingTransaction(false);
                  setNotice("Transaction created.");
                  // Phase 44 — same redundant-`router.refresh()` removal as
                  // Delete Transaction/Banking Rule apply above: a manually
                  // added transaction touches no master-data list either.
                  await fetchPage(cursorStack[cursorIndex], filters, sorting);
                }}
                onCancel={() => setAddingTransaction(false)}
              />
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}
