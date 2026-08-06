"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnSizingState, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { TransactionGrid } from "./transaction-grid";
import { TransactionFiltersBar, EMPTY_FILTER_DRAFT, type FilterDraft } from "./transaction-filters-bar";
import { TransactionColumnChooser } from "./transaction-column-chooser";
import { TransactionBulkActionBar, type MatchType, type RuleCreationOptions } from "./transaction-bulk-action-bar";
import { TransactionDetailPanel } from "./transaction-detail-panel";
import type { BankTransactionRecord, Supplier, TransactionDetail } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";
import { MOCK_TRANSACTIONS, MOCK_TRANSACTION_DETAILS } from "@/lib/mock/transaction-explorer-data";

const PAGE_SIZE = 50;

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
  initialTransactions,
  initialNextCursor,
  initialHasMore,
}: {
  companyId: string;
  previewMode: boolean;
  bankAccounts: { id: number; accountName: string }[];
  suppliers: Supplier[];
  customers: { id: number; name: string }[];
  merchants: Merchant[];
  initialTransactions: BankTransactionRecord[];
  initialNextCursor: string | null;
  initialHasMore: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTER_DRAFT);
  const [sorting, setSorting] = useState<SortingState>([{ id: "transactionDate", desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
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
  const [notice, setNotice] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [repeatedAllocationPrompt, setRepeatedAllocationPrompt] = useState<{
    transaction: BankTransactionRecord;
    ruleType: "GL" | "Customer" | "Supplier";
    action: { actionType: string; targetId?: number; targetText?: string };
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

  const selectedTransactions = useMemo(
    () => transactions.filter((t) => rowSelection[String(t.id)]),
    [transactions, rowSelection],
  );
  const selectedIds = useMemo(() => selectedTransactions.map((t) => t.id), [selectedTransactions]);

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
    action: { actionType: string; targetId?: number; targetText?: string },
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
        actions: [action],
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
    action: { actionType: string; targetId?: number; targetText?: string },
    target: { glAccount?: string; customerId?: number; supplierId?: number },
  ) {
    const params = new URLSearchParams({ transactionId: String(transaction.id), beneficiary: transaction.beneficiary });
    if (target.glAccount) params.set("glAccount", target.glAccount);
    if (target.customerId !== undefined) params.set("customerId", String(target.customerId));
    if (target.supplierId !== undefined) params.set("supplierId", String(target.supplierId));
    const res = await fetch(`/api/companies/${companyId}/transactions/repeated-allocation-check?${params.toString()}`);
    if (!res.ok) return;
    const body = await res.json();
    if (body.suggestRule) setRepeatedAllocationPrompt({ transaction, ruleType, action, count: body.count });
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

  return (
    <div className="flex min-w-0 flex-col gap-4">
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
            if (ruleOptions && t) await createRuleFromAllocation(t, "Supplier", { actionType: "set_supplier", targetId: supplierId }, ruleOptions);
            else if (!ruleOptions && t && selectedIds.length === 1) await checkRepeatedAllocation(t, "Supplier", { actionType: "set_supplier", targetId: supplierId }, { supplierId });
          }}
          onAssignMerchant={(merchantId) => runBulkAction({ action: "assign-merchant", transactionIds: selectedIds, merchantId })}
          onAssignCustomer={async (customerId, ruleOptions) => {
            const t = selectedTransactions[0];
            await runBulkAction({ action: "assign-customer", transactionIds: selectedIds, customerId });
            if (ruleOptions && t) await createRuleFromAllocation(t, "Customer", { actionType: "set_customer", targetId: customerId }, ruleOptions);
            else if (!ruleOptions && t && selectedIds.length === 1) await checkRepeatedAllocation(t, "Customer", { actionType: "set_customer", targetId: customerId }, { customerId });
          }}
          onAssignGl={async (glAccount, ruleOptions) => {
            const t = selectedTransactions[0];
            await runBulkAction({ action: "assign-gl", transactionIds: selectedIds, glAccount });
            if (ruleOptions && t) await createRuleFromAllocation(t, "GL", { actionType: "set_gl_account", targetText: glAccount }, ruleOptions);
            else if (!ruleOptions && t && selectedIds.length === 1) await checkRepeatedAllocation(t, "GL", { actionType: "set_gl_account", targetText: glAccount }, { glAccount });
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

        <div className="ml-auto flex items-center gap-2">
          <TransactionColumnChooser columnVisibility={columnVisibility} onChange={setColumnVisibility} />
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
              const { transaction, ruleType, action } = repeatedAllocationPrompt;
              setRepeatedAllocationPrompt(null);
              await createRuleFromAllocation(transaction, ruleType, action, {
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
    </div>
  );
}
