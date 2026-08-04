"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AllocationStatus, TransactionExplorerFilters } from "@/server/accounting/types";

const STATUSES: AllocationStatus[] = ["Matched", "Allocated", "Suggested", "Unallocated"];

export type FilterDraft = Pick<
  TransactionExplorerFilters,
  "search" | "dateFrom" | "dateTo" | "minAmount" | "maxAmount" | "statuses" | "bankAccountId" | "duplicateOnly" | "unknownSupplierOnly"
>;

export const EMPTY_FILTER_DRAFT: FilterDraft = {
  search: null,
  dateFrom: null,
  dateTo: null,
  minAmount: null,
  maxAmount: null,
  statuses: null,
  bankAccountId: null,
  duplicateOnly: false,
  unknownSupplierOnly: false,
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

  function reset() {
    setDraft(EMPTY_FILTER_DRAFT);
    onApply(EMPTY_FILTER_DRAFT);
  }

  return (
    <div className="flex flex-col gap-3 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="tx-search" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Search
          </label>
          <Input
            id="tx-search"
            placeholder="Description, reference, beneficiary…"
            value={draft.search ?? ""}
            onChange={(e) => update("search", e.target.value || null)}
            onKeyDown={(e) => e.key === "Enter" && onApply(draft)}
          />
        </div>

        <div>
          <label htmlFor="tx-date-from" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            From
          </label>
          <Input id="tx-date-from" type="date" value={draft.dateFrom ?? ""} onChange={(e) => update("dateFrom", e.target.value || null)} />
        </div>
        <div>
          <label htmlFor="tx-date-to" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            To
          </label>
          <Input id="tx-date-to" type="date" value={draft.dateTo ?? ""} onChange={(e) => update("dateTo", e.target.value || null)} />
        </div>

        <div className="w-28">
          <label htmlFor="tx-min-amount" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Min Amount
          </label>
          <Input
            id="tx-min-amount"
            type="number"
            inputMode="decimal"
            value={draft.minAmount ?? ""}
            onChange={(e) => update("minAmount", e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>
        <div className="w-28">
          <label htmlFor="tx-max-amount" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Max Amount
          </label>
          <Input
            id="tx-max-amount"
            type="number"
            inputMode="decimal"
            value={draft.maxAmount ?? ""}
            onChange={(e) => update("maxAmount", e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>

        <div className="min-w-[180px]">
          <label htmlFor="tx-bank-account" className="mb-1 block text-xs font-medium text-vf-ink-soft">
            Bank Account
          </label>
          <Select
            id="tx-bank-account"
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
        </div>

        <Button variant="primary" size="sm" onClick={() => onApply(draft)}>
          Apply Filters
        </Button>
        <Button variant="subtle" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-vf-ink-soft">
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="sr-only">Matching status</legend>
          {STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1.5">
              <input type="checkbox" checked={(draft.statuses ?? []).includes(status)} onChange={() => toggleStatus(status)} />
              {status}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={draft.duplicateOnly} onChange={(e) => update("duplicateOnly", e.target.checked)} />
          Possible duplicates only
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={draft.unknownSupplierOnly} onChange={(e) => update("unknownSupplierOnly", e.target.checked)} />
          Unknown supplier only
        </label>
      </div>
    </div>
  );
}
