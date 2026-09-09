"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AllocationStatus, TransactionExplorerFilters, TransactionPostingStatus } from "@/server/accounting/types";

const STATUSES: AllocationStatus[] = ["Matched", "Allocated", "Suggested", "Unallocated"];
/** Bank Accounting Posting — the workflow states, in workflow order. A
 * separate axis from Matching Status above and deliberately so: a
 * transaction can be fully Matched and still not posted. */
const POSTING_STATUSES: TransactionPostingStatus[] = ["Unprocessed", "Ready to Post", "Posted", "Reconciled"];

export type FilterDraft = Pick<
  TransactionExplorerFilters,
  | "search"
  | "dateFrom"
  | "dateTo"
  | "minAmount"
  | "maxAmount"
  | "statuses"
  | "bankAccountId"
  | "importBatch"
  | "duplicateOnly"
  | "unknownSupplierOnly"
  | "allocationMethods"
  | "postingStatuses"
>;

export const EMPTY_FILTER_DRAFT: FilterDraft = {
  search: null,
  dateFrom: null,
  dateTo: null,
  minAmount: null,
  maxAmount: null,
  statuses: null,
  bankAccountId: null,
  importBatch: null,
  duplicateOnly: false,
  unknownSupplierOnly: false,
  allocationMethods: null,
  postingStatuses: null,
};

export function TransactionFiltersBar({
  bankAccounts,
  onApply,
}: {
  bankAccounts: { id: number; accountName: string }[];
  onApply: (draft: FilterDraft) => void;
}) {
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTER_DRAFT);

  function update<K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function toggleStatus(status: AllocationStatus) {
    setDraft((prev) => {
      const current = prev.statuses ?? [];
      const next = current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
      return { ...prev, statuses: next.length > 0 ? next : null };
    });
  }

  function togglePostingStatus(status: TransactionPostingStatus) {
    setDraft((prev) => {
      const current = prev.postingStatuses ?? [];
      const next = current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
      return { ...prev, postingStatuses: next.length > 0 ? next : null };
    });
  }

  function reset() {
    setDraft(EMPTY_FILTER_DRAFT);
    onApply(EMPTY_FILTER_DRAFT);
  }

  // Phase 26F — compacted to exactly two lines (was: a padded/shadowed
  // card with a stacked label above every field, doubling the effective
  // height of the whole top row, plus a second internal row below it).
  // Every field keeps a real, accessible label (`sr-only` — present for
  // screen readers, zero visual height) instead of a visible label line;
  // sighted users read the field's purpose from its placeholder/adjacent
  // text instead. No functionality removed: every filter that existed
  // before (search, date range, amount range, bank account, status,
  // duplicates-only, unknown-supplier-only, apply, reset) is still here.
  return (
    <div className="flex flex-col gap-1.5 border-b border-vf-paper-border pb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="tx-search" className="sr-only">
            Search
          </label>
          <Input
            id="tx-search"
            className="h-9 px-3 py-1.5 text-sm"
            placeholder="Search description, reference, beneficiary…"
            value={draft.search ?? ""}
            onChange={(e) => update("search", e.target.value || null)}
            onKeyDown={(e) => e.key === "Enter" && onApply(draft)}
          />
        </div>

        <div className="flex items-center gap-1 text-xs text-vf-ink-faint">
          <label htmlFor="tx-date-from">From</label>
          <Input id="tx-date-from" type="date" className="h-9 w-[136px] px-2 py-1.5 text-sm" value={draft.dateFrom ?? ""} onChange={(e) => update("dateFrom", e.target.value || null)} />
        </div>
        <div className="flex items-center gap-1 text-xs text-vf-ink-faint">
          <label htmlFor="tx-date-to">To</label>
          <Input id="tx-date-to" type="date" className="h-9 w-[136px] px-2 py-1.5 text-sm" value={draft.dateTo ?? ""} onChange={(e) => update("dateTo", e.target.value || null)} />
        </div>

        <label htmlFor="tx-bank-account" className="sr-only">
          Bank account
        </label>
        <Select
          id="tx-bank-account"
          className="h-9 w-[150px] px-2 py-1.5 text-sm"
          value={draft.bankAccountId ?? ""}
          onChange={(e) => update("bankAccountId", e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">All accounts</option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountName}
            </option>
          ))}
        </Select>

        <label htmlFor="tx-min-amount" className="sr-only">
          Min amount
        </label>
        <Input
          id="tx-min-amount"
          type="number"
          inputMode="decimal"
          placeholder="Min"
          className="h-9 w-16 px-2 py-1.5 text-sm"
          value={draft.minAmount ?? ""}
          onChange={(e) => update("minAmount", e.target.value === "" ? null : Number(e.target.value))}
        />
        <label htmlFor="tx-max-amount" className="sr-only">
          Max amount
        </label>
        <Input
          id="tx-max-amount"
          type="number"
          inputMode="decimal"
          placeholder="Max"
          className="h-9 w-16 px-2 py-1.5 text-sm"
          value={draft.maxAmount ?? ""}
          onChange={(e) => update("maxAmount", e.target.value === "" ? null : Number(e.target.value))}
        />

        <Button variant="primary" size="sm" onClick={() => onApply(draft)}>
          Apply Filters
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-vf-ink-soft">
        <fieldset className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <legend className="sr-only">Matching status</legend>
          {STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1">
              <input type="checkbox" checked={(draft.statuses ?? []).includes(status)} onChange={() => toggleStatus(status)} />
              {status}
            </label>
          ))}
        </fieldset>
        {/* Bank Accounting Posting — separated from the Matching Status
            group by a divider because they answer different questions:
            Matching Status is "do we know what this is?", Posting Status
            is "has it reached the General Ledger?". Ticking "Ready to
            Post" is the intended way to find everything waiting to be
            posted. */}
        <span aria-hidden className="h-3.5 w-px bg-vf-paper-border" />
        <fieldset className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <legend className="sr-only">Posting status</legend>
          {POSTING_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1">
              <input type="checkbox" checked={(draft.postingStatuses ?? []).includes(status)} onChange={() => togglePostingStatus(status)} />
              {status}
            </label>
          ))}
        </fieldset>
        <span aria-hidden className="h-3.5 w-px bg-vf-paper-border" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={draft.duplicateOnly} onChange={(e) => update("duplicateOnly", e.target.checked)} />
          Duplicates only
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={draft.unknownSupplierOnly} onChange={(e) => update("unknownSupplierOnly", e.target.checked)} />
          Unknown supplier only
        </label>
        {/* Phase 28, Part 13 — the review-workflow filter for the
            forensic investigation's "AI Allocations requiring review"
            requirement. Reuses the existing `allocationMethods` filter
            field end-to-end (already applied server-side —
            `transaction-explorer-repository.ts` — and already
            URL-round-trippable — `transaction-explorer-service.ts`'s
            `parseFilters`); this checkbox is the only piece that was
            actually missing. Combine with the Matching Status checkboxes
            above (e.g. also ticking "Allocated"/"Suggested") to narrow
            further — deliberately independent, composable filters, not
            one checkbox silently setting several fields at once. */}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={(draft.allocationMethods ?? []).includes("Future AI")}
            onChange={(e) => update("allocationMethods", e.target.checked ? ["Future AI"] : null)}
          />
          AI needs review
        </label>
        <Button variant="subtle" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
