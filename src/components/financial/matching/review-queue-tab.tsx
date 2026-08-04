"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { SplitTransactionForm } from "./split-transaction-form";
import type { MatchingQueueItem, MatchingQueueItemType } from "@/server/services/matching-queue-service";

const TYPE_LABELS: Record<MatchingQueueItemType, string> = {
  BankTransaction: "Bank Transaction",
  UnknownMerchant: "Unknown Merchant",
  DuplicatePayment: "Duplicate Payment",
  DuplicateCustomer: "Duplicate Customer",
  DuplicateSupplier: "Duplicate Supplier",
  UnallocatedInvoice: "Unallocated Invoice",
  UnallocatedBill: "Unallocated Bill",
  CashbookEntry: "Cashbook Entry",
};

const ALL_TYPES = "All";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Every unmatched item in the system must appear here. Not in
 * multiple pages. Everything enters one queue." — one list across every
 * real matching type this platform tracks, each item linking straight
 * to its own real resolution workflow (Transaction Explorer, Sales,
 * Purchasing, Cashbook, Banking Exceptions) — matching actions still
 * happen in each domain's own tested workflow; this is the ONE place
 * they're all discoverable from. */
export function ReviewQueueTab({ companyId, queue, previewMode }: { companyId: string; queue: MatchingQueueItem[]; previewMode: boolean }) {
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [search, setSearch] = useState("");
  const [splittingId, setSplittingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    return queue.filter((item) => {
      if (typeFilter !== ALL_TYPES && item.itemType !== typeFilter) return false;
      const term = search.trim().toLowerCase();
      if (!term) return true;
      return item.description.toLowerCase().includes(term);
    });
  }, [queue, typeFilter, search]);

  const types = [ALL_TYPES, ...new Set(queue.map((i) => i.itemType))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="mq-type" className="mb-1 block text-xs font-medium text-vf-ink-faint">Type</label>
          <select id="mq-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="min-w-[200px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            {types.map((t) => (
              <option key={t} value={t}>
                {t === ALL_TYPES ? "All types" : TYPE_LABELS[t as MatchingQueueItemType]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="mq-search" className="mb-1 block text-xs font-medium text-vf-ink-faint">Search</label>
          <Input id="mq-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description…" />
        </div>
        <p className="pb-2 text-xs text-vf-ink-faint">{filtered.length} of {queue.length} items</p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nothing awaiting review." description="Every item across Bank Transactions, Customer/Supplier Matching, Duplicates, Allocation, and Cashbook is resolved." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((item) => {
            const idParts = item.id.split(":");
            const transactionId = item.itemType === "BankTransaction" ? Number(idParts[1]) : null;
            return (
              <div key={item.id} className="rounded-vf-md border border-vf-paper-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="info">{TYPE_LABELS[item.itemType]}</Badge>
                      {item.confidence !== null && <Badge tone={item.confidence >= 65 ? "good" : item.confidence > 0 ? "warn" : "muted"}>{Math.round(item.confidence)}% confidence</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-vf-ink">{item.description}</p>
                    <p className="mt-0.5 text-xs text-vf-ink-faint">
                      {item.date ?? "—"} {item.amount !== null && `· ${money(item.amount)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {transactionId !== null && (
                      <Button variant="subtle" size="sm" disabled={previewMode} title={previewMode ? "Available once a production Supabase project is connected" : undefined} onClick={() => setSplittingId(splittingId === transactionId ? null : transactionId)}>
                        Split
                      </Button>
                    )}
                    <Button href={item.detailHref} variant="primary" size="sm">
                      Resolve
                    </Button>
                  </div>
                </div>
                {transactionId !== null && splittingId === transactionId && (
                  <div className="mt-3 border-t border-vf-paper-border pt-3">
                    <SplitTransactionForm companyId={companyId} transactionId={transactionId} amount={Math.abs(item.amount ?? 0)} previewMode={previewMode} onDone={() => setSplittingId(null)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-vf-ink-faint">
        Full audit trail for every merge/override made from this workspace is available via{" "}
        <Link href={`/company/${companyId}/general-ledger?tab=journals`} className="text-vf-red-600 hover:underline">
          the General Ledger
        </Link>{" "}
        and each item&rsquo;s own source module.
      </p>
    </div>
  );
}
