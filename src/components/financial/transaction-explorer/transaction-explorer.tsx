"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnSizingState, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { TransactionGrid, ruleActionsFor, ruleTypeFor, type AllocateRowPayload } from "./transaction-grid";
import { TransactionFiltersBar, EMPTY_FILTER_DRAFT, type FilterDraft } from "./transaction-filters-bar";
import { TransactionColumnChooser } from "./transaction-column-chooser";
import { TransactionBulkActionBar, type MatchType, type RuleCreationOptions } from "./transaction-bulk-action-bar";
import { TransactionDetailPanel } from "./transaction-detail-panel";
import { MerchantIntelligencePanel } from "./merchant-intelligence-panel";
import type { BankTransactionRecord, Supplier, TransactionDetail } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import { MOCK_TRANSACTIONS, MOCK_TRANSACTION_DETAILS } from "@/lib/mock/transaction-explorer-data";

const PAGE_SIZE = 50;

function applyAllocationPatch(t: BankTransactionRecord, input: AllocateRowPayload): BankTransactionRecord {
  return {
    ...t,
    allocationType: input.type,
    allocationNotes: input.allocationNotes,
    suggestedGlAccount: input.type === "G" ? input.accountCode : t.suggestedGlAccount,
    suggestedVatCode: input.vatCode ?? t.suggestedVatCode,
    matchedSupplierId: input.type === "S" ? input.supplierId : t.matchedSupplierId,
    matchedCustomerId: input.type === "C" ? input.customerId : t.matchedCustomerId,
    allocationStatus: "Allocated" as const,
    isManualOverride: true,
  };
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

export function TransactionExplorer({
  companyId,
  previewMode,
  bankAccounts,
  suppliers,
  customers,
  merchants,
  chartOfAccounts,
  vatTreatments,
  initialTransactions,
  initialNextCursor,
  initialHasMore,
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
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTER_DRAFT);
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
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    glAccount: false, vatTreatment: false, customer: false, supplier: false,
    reference: false, bankAccount: false, merchant: false,
    rulesApplied: false, journalStatus: false, confidenceScore: false, requiredAction: false,
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Seeded from the server's own first fetch — no client mount-effect
  // fetch needed; every fetch after this one is triggered directly by the
  // event that changed the query (filter apply, sort click, pagination,
  // bulk action), never reactively.
  const [transactions, setTransactions] = useState<BankTransactionRecord[]>(initialTransactions);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [merchantPanelTransaction, setMerchantPanelTransaction] = useState<BankTransactionRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [repeatedAllocationPrompt, setRepeatedAllocationPrompt] = useState<{
    transaction: BankTransactionRecord;
    ruleType: "GL" | "Customer" | "Supplier";
    actions: { actionType: string; targetId?: number; targetText?: string }[];
    count: number;
  } | null>(null);

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
      if (filtersArg.duplicateOnly) params.set("duplicateOnly", "true");
      if (filtersArg.unknownSupplierOnly) params.set("unknownSupplierOnly", "true");
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
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/companies/${companyId}/transactions?${buildQuery(cursor, filtersArg, sortingArg)}`);
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? `Request failed (${res.status})`);
          return;
        }
        setTransactions(body.transactions);
        setNextCursor(body.nextCursor);
        setHasMore(body.hasMore);
      } catch {
        setError("Couldn't reach the API. Check the dev server is running.");
      } finally {
        setLoading(false);
      }
    },
    [previewMode, companyId, buildQuery],
  );

  function applyFilters(draft: FilterDraft) {
    setFilters(draft);
    setCursorStack([null]);
    setCursorIndex(0);
    setRowSelection({});
    fetchPage(null, draft, sorting);
  }

  function applySorting(updater: SortingState | ((old: SortingState) => SortingState)) {
    const nextSorting = typeof updater === "function" ? updater(sorting) : updater;
    setSorting(nextSorting);
    setCursorStack([null]);
    setCursorIndex(0);
    setRowSelection({});
    fetchPage(null, filters, nextSorting);
  }

  function goNext() {
    if (!nextCursor) return;
    const newStack = [...cursorStack.slice(0, cursorIndex + 1), nextCursor];
    setCursorStack(newStack);
    setCursorIndex(newStack.length - 1);
    fetchPage(nextCursor, filters, sorting);
  }

  function goPrevious() {
    if (cursorIndex === 0) return;
    const newIndex = cursorIndex - 1;
    setCursorIndex(newIndex);
    fetchPage(cursorStack[newIndex], filters, sorting);
  }

  /** Pilot Review Board follow-up — "at the top of Transaction Explorer,
   * display live-updating allocation statistics." Deliberately scoped to
   * the current page/filtered set (`transactions`, which already updates
   * in place as `allocateRowInline` commits rows — no refetch needed for
   * it to stay live) rather than the whole company: a genuinely
   * company-wide live count would mean re-querying the aggregate after
   * every single-row commit, which is exactly the full-page-refetch cost
   * `allocateRowInline`'s own design note explains this redesign exists
   * to avoid. The company-wide totals are already shown above this page
   * (`ExecutiveSummaryBar`, computed server-side on load) — this is
   * additive, not a replacement, and labelled "this page" so the two
   * never get confused for the same number. */
  const pageStats = useMemo(() => {
    let allocated = 0;
    let needsReview = 0;
    let rulesCreated = 0;
    let duplicates = 0;
    for (const t of transactions) {
      if (t.requiredAction === REQUIRED_ACTION_DUPLICATE_PAYMENT) duplicates++;
      else if (t.requiredAction) needsReview++;
      if (t.ruleId !== null || t.rulesTriggered.length > 0) rulesCreated++;
      if (t.allocationStatus === "Allocated" || t.allocationStatus === "Matched") allocated++;
    }
    return { imported: transactions.length, allocated, needsReview, rulesCreated, duplicates };
  }, [transactions]);

  const selectedTransactions = useMemo(
    () => transactions.filter((t) => rowSelection[String(t.id)]),
    [transactions, rowSelection],
  );
  const selectedIds = useMemo(() => selectedTransactions.map((t) => t.id), [selectedTransactions]);

  /** Pilot Review Board follow-up — "Apply To Merchant / Description /
   * Same Amount / Same Reference." Expands the existing checkbox
   * selection to every row on the current page matching the single
   * selected reference row, then the existing GL/VAT/Supplier/Customer
   * bulk buttons apply to the expanded set exactly as they already do
   * for a manual multi-select — no new bulk-apply code path needed.
   * "Merchant" matches on `beneficiary` (the bank statement's own payee
   * text), not `matchedMerchantId`, since most transactions don't have
   * Merchant Coding run against them yet at allocation time. */
  function selectSimilar(reference: BankTransactionRecord, criterion: "merchant" | "description" | "amount" | "reference") {
    const matches = transactions.filter((t) => {
      if (criterion === "merchant") return t.beneficiary === reference.beneficiary;
      if (criterion === "description") return t.description === reference.description;
      if (criterion === "amount") return Math.max(t.debit, t.credit) === Math.max(reference.debit, reference.credit);
      return reference.reference !== "" && t.reference === reference.reference;
    });
    const next: RowSelectionState = {};
    for (const t of matches) next[String(t.id)] = true;
    setRowSelection(next);
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
      setRowSelection({});
      await fetchPage(cursorStack[cursorIndex], filters, sorting);
      router.refresh();
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
        conditions: [{ field: "beneficiary", operator, value }],
        actions,
      }),
    });
    const ruleBody = await ruleRes.json();
    if (!ruleRes.ok) {
      setError(`Allocation saved, but the Banking Rule could not be created: ${ruleBody.error ?? ruleRes.status}`);
      return;
    }

    if (!options.applyToRemaining || !transaction.importBatch) {
      setNotice(`Banking Rule "${ruleBody.rule.name}" created.`);
      return;
    }

    const applyRes = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply-rule-to-batch", importBatch: transaction.importBatch, excludeTransactionId: transaction.id }),
    });
    const applyBody = await applyRes.json();
    if (!applyRes.ok) {
      setNotice(`Banking Rule "${ruleBody.rule.name}" created, but applying it to the rest of the statement failed: ${applyBody.error ?? applyRes.status}`);
      return;
    }
    const results: { transactionId: number; matchedRuleIds: number[] }[] = applyBody.results ?? [];
    const matchedIds = results.filter((r) => r.matchedRuleIds.length > 0).map((r) => r.transactionId);
    setHighlightedIds(new Set(matchedIds));
    setNotice(`Banking Rule "${ruleBody.rule.name}" created and applied to ${matchedIds.length} more transaction${matchedIds.length === 1 ? "" : "s"} in this statement.`);
    if (matchedIds.length > 0) {
      await fetchPage(cursorStack[cursorIndex], filters, sorting);
      router.refresh();
    }
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
  async function allocateRowInline(transaction: BankTransactionRecord, input: AllocateRowPayload, ruleOptions: RuleCreationOptions | null): Promise<boolean> {
    if (previewMode) return false;
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allocate-row", transactionIds: [transaction.id], ...input }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return false;
      }
      setTransactions((prev) => prev.map((t) => (t.id === transaction.id ? applyAllocationPatch(t, input) : t)));

      if (ruleOptions) {
        await createRuleFromAllocation(transaction, ruleTypeFor(input.type), ruleActionsFor(input), ruleOptions);
      }
      return true;
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
      return false;
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
      const idSet = new Set(transactionIds);
      setTransactions((prev) => prev.map((t) => (idSet.has(t.id) ? applyAllocationPatch(t, input) : t)));
      return true;
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
      return false;
    }
  }

  /** Backs the new inline grid's "Set Rule" checkbox — a non-mutating
   * check so a true duplicate renders as an inline badge before the rule
   * is ever created, not just after. */
  async function checkDuplicateRule(
    transaction: BankTransactionRecord,
    ruleType: "GL" | "Customer" | "Supplier",
    actions: { actionType: string; targetId?: number; targetText?: string }[],
  ): Promise<string | null> {
    if (previewMode) return null;
    try {
      const res = await fetch(`/api/companies/${companyId}/banking-rules/check-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "Banking",
          ruleType,
          conditions: [{ field: "beneficiary", operator: "contains", value: transaction.beneficiary }],
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-vf-ink-faint" role="status" aria-live="polite">
        <span className="font-semibold tracking-wide uppercase">This page</span>
        <span>Imported <span className="font-mono font-semibold text-vf-ink">{pageStats.imported}</span></span>
        <span>·</span>
        <span>Allocated <span className="font-mono font-semibold text-[#1f6e4b]">{pageStats.allocated}</span></span>
        <span>·</span>
        <span>Needs Review <span className="font-mono font-semibold text-orange-700">{pageStats.needsReview}</span></span>
        <span>·</span>
        <span>Rules Created <span className="font-mono font-semibold text-vf-info">{pageStats.rulesCreated}</span></span>
        <span>·</span>
        <span>Duplicates <span className="font-mono font-semibold text-vf-ink">{pageStats.duplicates}</span></span>
      </div>

      <TransactionFiltersBar bankAccounts={bankAccounts} onApply={applyFilters} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TransactionBulkActionBar
          selected={selectedTransactions}
          suppliers={suppliers}
          customers={customers}
          merchants={merchants}
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
          onGenerateJournal={() => runBulkAction({ action: "generate-journal", transactionIds: selectedIds })}
          onApplyRule={() => runBulkAction({ action: "apply-rule", transactionIds: selectedIds })}
          onDeleteImport={() =>
            runBulkAction({ action: "delete-import", importType: "bank_transactions", importBatch: selectedTransactions[0]?.importBatch })
          }
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
          <Button variant="subtle" size="sm" disabled={previewMode} title={previewMode ? "Available once a production Supabase project is connected" : undefined} onClick={() => window.open(exportUrl("csv"), "_blank")}>
            Export CSV
          </Button>
          <Button variant="subtle" size="sm" disabled={previewMode} title={previewMode ? "Available once a production Supabase project is connected" : undefined} onClick={() => window.open(exportUrl("xlsx"), "_blank")}>
            Export Excel
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}
      {notice && <p className="text-sm text-[#1f6e4b]">{notice}</p>}

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
              await createRuleFromAllocation(transaction, ruleType, actions, {
                matchDescription: transaction.beneficiary, matchType: "contains", applyToRemaining: true, applyToFutureImports: true,
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

      <TransactionGrid
        transactions={transactions}
        sorting={sorting}
        onSortingChange={applySorting}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        columnSizing={columnSizing}
        onColumnSizingChange={setColumnSizing}
        onRowClick={openDetail}
        loading={loading}
        highlightedIds={highlightedIds}
        suppliers={suppliers}
        customers={customers}
        chartOfAccounts={chartOfAccounts}
        vatTreatments={vatTreatments}
        onAllocateRow={allocateRowInline}
        onBulkAllocate={allocateRowsInline}
        onCheckDuplicateRule={checkDuplicateRule}
        onMerchantClick={setMerchantPanelTransaction}
      />

      {!previewMode && (
        <div className="flex items-center justify-between text-sm text-vf-ink-faint">
          <span>{transactions.length} transaction(s) on this page</span>
          <div className="flex gap-2">
            <Button variant="subtle" size="sm" disabled={cursorIndex === 0 || loading} onClick={goPrevious}>
              Previous
            </Button>
            <Button variant="subtle" size="sm" disabled={!hasMore || loading} onClick={goNext}>
              Next
            </Button>
          </div>
        </div>
      )}

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
      />

      {merchantPanelTransaction && (
        <MerchantIntelligencePanel
          companyId={companyId}
          transaction={merchantPanelTransaction}
          transactions={transactions}
          merchants={merchants}
          onClose={() => setMerchantPanelTransaction(null)}
        />
      )}
    </div>
  );
}
