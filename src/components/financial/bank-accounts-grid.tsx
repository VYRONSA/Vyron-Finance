"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBank } from "@/components/ui/icons";
import type { BankAccountSummary, BankAccountStatus } from "@/server/accounting/types";
import { formatAmount, formatCount } from "@/lib/format";

const STATUS_TONE: Record<BankAccountStatus, "good" | "muted"> = {
  Active: "good",
  Archived: "muted",
};

const ALL_STATUSES = "All";
type StatusFilter = BankAccountStatus | typeof ALL_STATUSES;

type SortKey = "name" | "balance";

function money(value: number, currency: string) {
  return `${currency} ${formatAmount(value)}`;
}

function maskAccountNumber(accountNumber: string): string {
  return accountNumber.length > 4 ? `•••• ${accountNumber.slice(-4)}` : accountNumber;
}

/** Phase 7 — Banking Command Centre. `BankAccount` has no reconciliation
 * "status" field, only `lastReconciliationDate` — this derives an honest
 * three-state label from that real date instead of inventing a status
 * the schema doesn't have. Pure, exported for direct testing. */
export type ReconciliationStatusLabel = "Reconciled" | "Overdue" | "Never Reconciled";

export function reconciliationStatusLabel(lastReconciliationDate: string | null, now: Date = new Date()): ReconciliationStatusLabel {
  if (!lastReconciliationDate) return "Never Reconciled";
  const days = Math.floor((now.getTime() - new Date(lastReconciliationDate).getTime()) / 86_400_000);
  return days > 30 ? "Overdue" : "Reconciled";
}

const RECONCILIATION_TONE: Record<ReconciliationStatusLabel, "good" | "warn" | "muted"> = {
  Reconciled: "good",
  Overdue: "warn",
  "Never Reconciled": "muted",
};

/** Finding #139 — the account list had no search, filter, or sort at
 * all; the full list is already fetched server-side (Bank Accounts is
 * never a huge list per company), so this is purely client-side over
 * already-loaded data — no new fetch needed. */
export function BankAccountsGrid({ summaries, companyId }: { summaries: BankAccountSummary[]; companyId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = summaries.filter((s) => {
      if (statusFilter !== ALL_STATUSES && s.account.status !== statusFilter) return false;
      if (!term) return true;
      return (
        s.account.accountName.toLowerCase().includes(term) ||
        s.account.bankName.toLowerCase().includes(term) ||
        s.account.accountNumber.toLowerCase().includes(term)
      );
    });
    rows = [...rows].sort((a, b) =>
      sortKey === "balance" ? b.account.currentBalance - a.account.currentBalance : a.account.accountName.localeCompare(b.account.accountName),
    );
    return rows;
  }, [summaries, search, statusFilter, sortKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="ba-search" className="mb-1 block text-xs font-medium text-vf-ink-faint">Search</label>
          <Input id="ba-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Account name, bank, or number…" />
        </div>
        <div>
          <label htmlFor="ba-status" className="mb-1 block text-xs font-medium text-vf-ink-faint">Status</label>
          <select
            id="ba-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            <option value={ALL_STATUSES}>All statuses</option>
            <option value="Active">Active</option>
            <option value="Archived">Archived</option>
          </select>
        </div>
        <div>
          <label htmlFor="ba-sort" className="mb-1 block text-xs font-medium text-vf-ink-faint">Sort by</label>
          <select
            id="ba-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            <option value="name">Name</option>
            <option value="balance">Balance (highest first)</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<IconBank className="h-5 w-5" />} title="No accounts match this search." description="Clear the search or status filter to see every account." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((summary) => (
            <AccountCard key={summary.account.id} summary={summary} companyId={companyId} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountCard({ summary, companyId }: { summary: BankAccountSummary; companyId: string }) {
  const { account } = summary;
  const reconciliation = reconciliationStatusLabel(account.lastReconciliationDate);
  return (
    <Link href={`/company/${companyId}/bank-accounts/${account.id}`}>
      <Card className="flex h-full flex-col justify-between p-5 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-vf-paper-lg">
        <CardContent className="flex h-full flex-col justify-between gap-4 p-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-sans text-sm font-semibold text-vf-ink">{account.accountName}</p>
              <p className="text-xs text-vf-ink-faint">{account.bankName}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge tone={STATUS_TONE[account.status]}>{account.status}</Badge>
              <Badge tone={RECONCILIATION_TONE[reconciliation]}>{reconciliation}</Badge>
            </div>
          </div>

          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums text-vf-ink">
              {money(account.currentBalance, account.currency)}
            </p>
            <p className="mt-0.5 font-mono text-xs text-vf-ink-faint">{maskAccountNumber(account.accountNumber)}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-vf-paper-border pt-3 text-xs">
            <dt className="text-vf-ink-faint">Account Type</dt>
            <dd className="text-right text-vf-ink-soft">{account.accountType || "Not available"}</dd>
            <dt className="text-vf-ink-faint">Currency</dt>
            <dd className="text-right text-vf-ink-soft">{account.currency || "Not available"}</dd>
            <dt className="text-vf-ink-faint">Transactions</dt>
            <dd className="text-right font-mono tabular-nums text-vf-ink-soft" title={summary.transactionCountCapped ? "Capped at the most recent 10,000 — true count may be higher." : undefined}>
              {formatCount(summary.transactionCount)}
              {summary.transactionCountCapped && "+"}
            </dd>
            <dt className="text-vf-ink-faint">Last Import</dt>
            <dd className="text-right text-vf-ink-soft">{summary.lastImport ?? "Never"}</dd>
            <dt className="text-vf-ink-faint">Last Reconciled</dt>
            <dd className="text-right text-vf-ink-soft">{account.lastReconciliationDate ?? "Never"}</dd>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
