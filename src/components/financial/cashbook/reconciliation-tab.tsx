"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { BankReconciliation } from "@/server/banking/types";
import type { ReconciliationSummary } from "@/server/banking/reconciliation-engine";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_TONE: Record<string, "muted" | "info" | "good" | "warn"> = { InProgress: "info", Completed: "good", Reopened: "warn" };

function StartReconciliationForm({ companyId, bankAccounts, previewMode }: { companyId: string; bankAccounts: { id: number; accountName: string }[]; previewMode: boolean }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? 0);
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [statementClosingBalance, setStatementClosingBalance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId, statementDate, statementClosingBalance: Number(statementClosingBalance) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-6">
        <div>
          <label htmlFor="rec-bank-account" className="mb-1 block text-xs font-medium text-vf-ink-faint">Bank Account</label>
          <select id="rec-bank-account" value={bankAccountId} onChange={(e) => setBankAccountId(Number(e.target.value))} className="min-w-[200px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rec-statement-date" className="mb-1 block text-xs font-medium text-vf-ink-faint">Statement Date</label>
          <Input id="rec-statement-date" type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label htmlFor="rec-closing-balance" className="mb-1 block text-xs font-medium text-vf-ink-faint">Statement Closing Balance</label>
          <Input id="rec-closing-balance" type="number" step="0.01" value={statementClosingBalance} onChange={(e) => setStatementClosingBalance(e.target.value)} className="w-40" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading || !statementClosingBalance} title={disabledTitle} onClick={start}>
          Start Reconciliation
        </Button>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ActiveReconciliation({ companyId, reconciliation, summary, previewMode }: { companyId: string; reconciliation: BankReconciliation; summary: ReconciliationSummary; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [lockMonthEnd, setLockMonthEnd] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function autoMatch() {
    setLoading("auto");
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}/auto-match`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function toggleClear(transactionId: number, cleared: boolean) {
    setLoading(`clear-${transactionId}`);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, cleared }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function complete() {
    setLoading("complete");
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", lockMonthEnd }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  async function reopen() {
    setLoading("reopen");
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen", reason: reopenReason }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  const isEditable = reconciliation.status !== "Completed";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-vf-ink">Statement Date {reconciliation.statementDate}</h3>
            <p className="mt-1 text-xs text-vf-ink-faint">Bank Balance vs. General Ledger control account, live.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[reconciliation.status]}>{reconciliation.status}</Badge>
            {reconciliation.monthEndLocked && <Badge tone="warn">Month-End Locked</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">Statement Balance</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(summary.statementClosingBalance)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">GL Balance</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{money(summary.glClosingBalance)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">Difference</p>
            <p className={`font-mono text-base font-semibold tabular-nums ${summary.isBalanced ? "text-vf-success" : "text-vf-danger"}`}>{money(summary.difference)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">Outstanding Items</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{summary.outstandingItems.length}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-vf-ink-faint">
          <span>Outstanding Deposits: <span className="font-mono text-vf-ink">{money(summary.outstandingDepositsTotal)}</span></span>
          <span>Outstanding Payments: <span className="font-mono text-vf-ink">{money(summary.outstandingPaymentsTotal)}</span></span>
          <span>Unprocessed (no journal yet): <span className="font-mono text-vf-ink">{summary.unprocessedCount}</span></span>
        </div>

        {isEditable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || loading !== null} title={disabledTitle} onClick={autoMatch}>
              {loading === "auto" ? "Matching…" : "Auto Match (already-journaled items)"}
            </Button>
          </div>
        )}

        {summary.outstandingItems.length === 0 ? (
          <EmptyState title="Nothing outstanding." description="Every transaction up to this statement date has been reconciled." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {summary.outstandingItems.map((item) => (
              <div key={item.transactionId} className="flex items-center justify-between gap-2 rounded-vf-sm border border-vf-paper-border p-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-vf-ink-faint">{item.transactionDate}</span>
                  <span className="text-vf-ink">{item.description}</span>
                  {!item.hasJournal && <Badge tone="warn">No Journal Yet</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-vf-ink">{money(item.credit || item.debit)}</span>
                  {isEditable && (
                    <Button variant="subtle" size="sm" disabled={previewMode || loading !== null} title={disabledTitle} onClick={() => toggleClear(item.transactionId, true)}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {isEditable ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-vf-paper-border pt-4">
            <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
              <input type="checkbox" checked={lockMonthEnd} onChange={(e) => setLockMonthEnd(e.target.checked)} />
              Lock as month-end (blocks new Cashbook entries on/before this date)
            </label>
            <Button variant="primary" size="sm" disabled={previewMode || loading !== null} title={disabledTitle} onClick={complete}>
              {loading === "complete" ? "Completing…" : "Complete Reconciliation"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3 border-t border-vf-paper-border pt-4">
            <div className="flex-1 min-w-[220px]">
              <label htmlFor="rec-reopen-reason" className="mb-1 block text-xs font-medium text-vf-ink-faint">Reason to Reopen</label>
              <Input id="rec-reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Required to reopen a completed reconciliation" />
            </div>
            <Button variant="subtle" size="sm" disabled={previewMode || loading !== null || !reopenReason.trim()} title={disabledTitle} onClick={reopen}>
              {loading === "reopen" ? "Reopening…" : "Reopen Reconciliation"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReconciliationTab({
  companyId,
  bankAccounts,
  reconciliations,
  activeReconciliation,
  activeSummary,
  previewMode,
}: {
  companyId: string;
  bankAccounts: { id: number; accountName: string }[];
  reconciliations: BankReconciliation[];
  activeReconciliation: BankReconciliation | null;
  activeSummary: ReconciliationSummary | null;
  previewMode: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">Outstanding deposits/payments, auto/manual matching, a real Bank Balance vs. GL Balance difference, reconciliation history, re-opening, and a month-end lock.</p>
      <StartReconciliationForm companyId={companyId} bankAccounts={bankAccounts} previewMode={previewMode} />

      {activeReconciliation && activeSummary && <ActiveReconciliation companyId={companyId} reconciliation={activeReconciliation} summary={activeSummary} previewMode={previewMode} />}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h3 className="text-sm font-semibold text-vf-ink">Reconciliation History</h3>
          {reconciliations.length === 0 ? (
            <EmptyState title="No reconciliations yet." description="Start one above." />
          ) : (
            <div className="flex flex-col gap-2">
              {reconciliations.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-vf-sm border border-vf-paper-border p-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-vf-ink">{r.statementDate}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.monthEndLocked && <Badge tone="warn">Locked</Badge>}
                  </div>
                  <span className={`font-mono text-xs tabular-nums ${r.difference === 0 ? "text-vf-success" : "text-vf-danger"}`}>{r.difference !== null ? money(r.difference) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
