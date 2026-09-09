"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { formatMoney } from "@/lib/money";
import type { BankReconciliation } from "@/server/banking/types";
import type { ReconciliationItem, ReconciliationSummary } from "@/server/banking/reconciliation-engine";

/**
 * The Bank Reconciliation workspace.
 *
 * It shows its working rather than only its verdict. A reconciliation
 * proves one identity —
 *
 *   opening balance + cleared deposits - cleared payments = closing balance
 *
 * — so the workspace lays out each term, the reconciled balance they
 * produce, the difference against the statement, and a breakdown naming
 * every component of that difference in money terms. Being out of balance
 * is the normal middle of the job, not an error to be hidden; the
 * accountant needs to see WHY, not just THAT.
 *
 * Nothing here alters a transaction. Clearing an item records that it
 * appears on the bank statement; it never changes an amount, a date or an
 * allocation.
 */

const STATUS_TONE: Record<string, "muted" | "info" | "good" | "warn"> = { InProgress: "info", Completed: "good", Reopened: "warn" };

function StartReconciliationForm({ companyId, bankAccounts, previewMode }: { companyId: string; bankAccounts: { id: number; accountName: string; currency: string }[]; previewMode: boolean }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? 0);
  const [periodStart, setPeriodStart] = useState("");
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [openingBalance, setOpeningBalance] = useState("");
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
        body: JSON.stringify({
          bankAccountId,
          statementPeriodStart: periodStart || null,
          statementDate,
          statementOpeningBalance: Number(openingBalance || 0),
          statementClosingBalance: Number(statementClosingBalance),
        }),
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
          <label htmlFor="rec-period-start" className="mb-1 block text-xs font-medium text-vf-ink-faint">Period From</label>
          <Input id="rec-period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" />
        </div>
        <div>
          <label htmlFor="rec-statement-date" className="mb-1 block text-xs font-medium text-vf-ink-faint">Period To (Statement Date)</label>
          <Input id="rec-statement-date" type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label htmlFor="rec-opening-balance" className="mb-1 block text-xs font-medium text-vf-ink-faint">Statement Opening Balance</label>
          <Input id="rec-opening-balance" type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="w-44" />
        </div>
        <div>
          <label htmlFor="rec-closing-balance" className="mb-1 block text-xs font-medium text-vf-ink-faint">Statement Closing Balance</label>
          <Input id="rec-closing-balance" type="number" step="0.01" value={statementClosingBalance} onChange={(e) => setStatementClosingBalance(e.target.value)} className="w-44" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading || !statementClosingBalance} title={disabledTitle} onClick={start}>
          {loading ? "Starting…" : "Start Reconciliation"}
        </Button>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  currency,
  editable,
  busy,
  onToggle,
}: {
  item: ReconciliationItem;
  currency: string;
  editable: boolean;
  busy: boolean;
  onToggle: (transactionId: number, cleared: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-vf-sm border border-vf-paper-border p-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        {editable && (
          <input
            type="checkbox"
            aria-label={`Mark ${item.description} as cleared`}
            checked={item.isCleared}
            disabled={busy}
            onChange={(e) => onToggle(item.transactionId, e.target.checked)}
          />
        )}
        <span className="shrink-0 text-vf-ink-faint">{item.transactionDate}</span>
        <span className="truncate text-vf-ink">{item.description}</span>
        {!item.isPosted && <Badge tone="warn">Not Posted</Badge>}
      </div>
      <span className="shrink-0 font-mono tabular-nums text-vf-ink">{formatMoney(item.amount, currency)}</span>
    </div>
  );
}

function ItemColumn({
  title,
  items,
  total,
  currency,
  editable,
  busy,
  onToggle,
  emptyLabel,
}: {
  title: string;
  items: ReconciliationItem[];
  total: number;
  currency: string;
  editable: boolean;
  busy: boolean;
  onToggle: (transactionId: number, cleared: boolean) => void;
  emptyLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-vf-ink-faint">
          {title} ({items.length})
        </h4>
        <span className="font-mono text-sm tabular-nums text-vf-ink">{formatMoney(total, currency)}</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-vf-sm border border-dashed border-vf-paper-border p-2 text-xs text-vf-ink-faint">{emptyLabel}</p>
      ) : (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {items.map((item) => (
            <ItemRow key={item.transactionId} item={item} currency={currency} editable={editable} busy={busy} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveReconciliation({
  companyId,
  reconciliation,
  summary,
  currency,
  previewMode,
}: {
  companyId: string;
  reconciliation: BankReconciliation;
  summary: ReconciliationSummary;
  currency: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [lockMonthEnd, setLockMonthEnd] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [openingBalance, setOpeningBalance] = useState(String(reconciliation.statementOpeningBalance));
  const [closingBalance, setClosingBalance] = useState(String(reconciliation.statementClosingBalance));
  const [error, setError] = useState<string | null>(null);
  const completeConfirm = useConfirmTarget<true>();
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const isEditable = reconciliation.status !== "Completed";

  async function patch(key: string, body: Record<string, unknown>) {
    setLoading(key);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function autoMatch() {
    setLoading("auto");
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}/auto-match`, { method: "POST" });
      if (res.ok) router.refresh();
      else setError("Auto match failed.");
    } finally {
      setLoading(null);
    }
  }

  async function toggleClear(transactionId: number, cleared: boolean) {
    setLoading(`clear-${transactionId}`);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/bank-reconciliations/${reconciliation.id}/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, cleared }),
      });
      if (res.ok) router.refresh();
      else setError("Couldn't update that item.");
    } finally {
      setLoading(null);
    }
  }

  const busy = loading !== null || previewMode;
  const periodLabel = summary.periodStart ? `${summary.periodStart} to ${summary.periodEnd}` : `up to ${summary.periodEnd}`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-vf-ink">Statement Period {periodLabel}</h3>
            <p className="mt-1 text-xs text-vf-ink-faint">
              Opening balance plus cleared deposits, less cleared payments, must equal the statement&apos;s closing balance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[reconciliation.status]}>{reconciliation.status}</Badge>
            {reconciliation.monthEndLocked && <Badge tone="warn">Month-End Locked</Badge>}
          </div>
        </div>

        {/* The reconciliation arithmetic, laid out in the order it is
            calculated so the reconciled balance is visibly a consequence
            of the four figures above it rather than an opaque number. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">Opening Balance</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{formatMoney(summary.statementOpeningBalance, currency)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">+ Cleared Deposits</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{formatMoney(summary.clearedDepositsTotal, currency)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">− Cleared Payments</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{formatMoney(summary.clearedPaymentsTotal, currency)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">= Reconciled Balance</p>
            <p className="font-mono text-base font-semibold tabular-nums text-vf-ink">{formatMoney(summary.reconciledBalance, currency)}</p>
          </div>
          <div className="rounded-vf-md bg-vf-red-500/5 px-4 py-3">
            <p className="text-xs text-vf-ink-faint">Out of Balance By</p>
            <p className={`font-mono text-base font-semibold tabular-nums ${summary.isBalanced ? "text-vf-success" : "text-vf-danger"}`}>
              {formatMoney(summary.outOfBalanceBy, currency)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-vf-ink-faint">
          <span>
            Statement Closing Balance: <span className="font-mono text-vf-ink">{formatMoney(summary.statementClosingBalance, currency)}</span>
          </span>
          <span>
            VYRON General Ledger Balance: <span className="font-mono text-vf-ink">{formatMoney(summary.glClosingBalance, currency)}</span>
          </span>
          <span>
            VYRON vs Bank:{" "}
            <span className={`font-mono ${summary.glMatchesStatement ? "text-vf-success" : "text-vf-danger"}`}>{formatMoney(summary.difference, currency)}</span>
          </span>
        </div>

        {/* Why it doesn't balance — named in money terms, so the
            accountant can act on it instead of hunting for it. */}
        {(!summary.isBalanced || summary.unpostedCount > 0) && (
          <div className="flex flex-col gap-1.5 rounded-vf-md border border-vf-warning/30 bg-vf-warning/8 px-3.5 py-3">
            <p className="text-xs font-semibold text-vf-ink">Why this reconciliation does not balance</p>
            {summary.differenceReasons.length === 0 && summary.isBalanced ? (
              <p className="text-xs text-vf-ink-soft">The statement balances. The note below is about the General Ledger side only.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {summary.differenceReasons.map((reason) => (
                  <li key={reason.label} className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-vf-ink-soft">
                    <span>
                      {reason.label}
                      {reason.count > 0 ? ` (${reason.count})` : ""}
                    </span>
                    <span className="font-mono tabular-nums text-vf-ink">{formatMoney(reason.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.unpostedCount > 0 && (
              <p className="text-xs text-vf-ink-soft">
                {summary.unpostedCount} transaction{summary.unpostedCount === 1 ? " in this period has" : "s in this period have"} not been posted to the General Ledger
                ({formatMoney(summary.unpostedTotal, currency)}), so the General Ledger balance above does not yet include them. Post them from Transaction Explorer using
                “Post to Accounting”.
              </p>
            )}
          </div>
        )}

        {isEditable && (
          <div className="flex flex-wrap items-end gap-3 border-t border-vf-paper-border pt-3">
            <div>
              <label htmlFor="rec-confirm-opening" className="mb-1 block text-xs font-medium text-vf-ink-faint">Confirm Opening Balance</label>
              <Input id="rec-confirm-opening" type="number" step="0.01" className="w-40" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rec-confirm-closing" className="mb-1 block text-xs font-medium text-vf-ink-faint">Confirm Closing Balance</label>
              <Input id="rec-confirm-closing" type="number" step="0.01" className="w-40" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} />
            </div>
            <Button
              variant="subtle"
              size="sm"
              disabled={busy}
              title={disabledTitle}
              onClick={() => patch("figures", { action: "update-statement", statementOpeningBalance: Number(openingBalance || 0), statementClosingBalance: Number(closingBalance || 0) })}
            >
              {loading === "figures" ? "Saving…" : "Update Statement Figures"}
            </Button>
            <Button variant="subtle" size="sm" disabled={busy} title={disabledTitle} onClick={autoMatch}>
              {loading === "auto" ? "Matching…" : "Auto Match Posted Items"}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-vf-danger">{error}</p>}

        <div className="flex flex-col gap-4 border-t border-vf-paper-border pt-3 lg:flex-row">
          <ItemColumn
            title="Deposits — Not Cleared"
            items={summary.unreconciledDeposits}
            total={summary.unreconciledDepositsTotal}
            currency={currency}
            editable={isEditable}
            busy={busy}
            onToggle={toggleClear}
            emptyLabel="Every deposit in this period has been cleared."
          />
          <ItemColumn
            title="Payments — Not Cleared"
            items={summary.unreconciledPayments}
            total={summary.unreconciledPaymentsTotal}
            currency={currency}
            editable={isEditable}
            busy={busy}
            onToggle={toggleClear}
            emptyLabel="Every payment in this period has been cleared."
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-vf-paper-border pt-3 lg:flex-row">
          <ItemColumn
            title="Deposits — Cleared"
            items={summary.clearedDeposits}
            total={summary.clearedDepositsTotal}
            currency={currency}
            editable={isEditable}
            busy={busy}
            onToggle={toggleClear}
            emptyLabel="Nothing cleared yet."
          />
          <ItemColumn
            title="Payments — Cleared"
            items={summary.clearedPayments}
            total={summary.clearedPaymentsTotal}
            currency={currency}
            editable={isEditable}
            busy={busy}
            onToggle={toggleClear}
            emptyLabel="Nothing cleared yet."
          />
        </div>

        {isEditable ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-vf-paper-border pt-4">
            <label className="flex items-center gap-1.5 text-xs text-vf-ink-soft">
              <input type="checkbox" checked={lockMonthEnd} onChange={(e) => setLockMonthEnd(e.target.checked)} />
              Lock as month-end (blocks new Cashbook entries on/before this date)
            </label>
            {completeConfirm.isConfirming(true) ? (
              <ConfirmActionRow
                layout="panel"
                message={
                  summary.isBalanced
                    ? "Complete this reconciliation? This locks all cleared items against this statement."
                    : `This reconciliation is out of balance by ${formatMoney(summary.outOfBalanceBy, currency)}. Complete it anyway?`
                }
                itemsPreview={
                  summary.isBalanced ? undefined : (
                    <p className="text-xs">
                      Completing an out-of-balance reconciliation is allowed and is recorded as-is — VYRON never adjusts your figures to force a balance. The difference stays
                      visible in the reconciliation history.
                    </p>
                  )
                }
                confirmLabel="Confirm Complete"
                confirmingLabel="Completing…"
                loading={loading === "complete"}
                onConfirm={async () => {
                  const ok = await patch("complete", { action: "complete", lockMonthEnd });
                  if (ok) completeConfirm.cancel();
                }}
                onCancel={completeConfirm.cancel}
              />
            ) : (
              <Button variant="primary" size="sm" disabled={busy} title={disabledTitle} onClick={() => completeConfirm.request(true)}>
                Complete Reconciliation
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3 border-t border-vf-paper-border pt-4">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="rec-reopen-reason" className="mb-1 block text-xs font-medium text-vf-ink-faint">Reason to Reopen</label>
              <Input id="rec-reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Required to reopen a completed reconciliation" />
            </div>
            <Button variant="subtle" size="sm" disabled={busy || !reopenReason.trim()} title={disabledTitle} onClick={() => patch("reopen", { action: "reopen", reason: reopenReason })}>
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
  bankAccounts: { id: number; accountName: string; currency: string }[];
  reconciliations: BankReconciliation[];
  activeReconciliation: BankReconciliation | null;
  activeSummary: ReconciliationSummary | null;
  previewMode: boolean;
}) {
  // Master Implementation Tracker — Programme 2, Root Cause RC-13, Finding #081.
  const currencyByAccountId = new Map(bankAccounts.map((a) => [a.id, a.currency]));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">
        Pick an account and statement period, confirm the statement&apos;s opening and closing balances, tick off the deposits and payments that appear on it, and complete the
        reconciliation when you choose to. The difference is always explained, and never adjusted for you.
      </p>
      <StartReconciliationForm companyId={companyId} bankAccounts={bankAccounts} previewMode={previewMode} />

      {activeReconciliation && activeSummary && (
        <ActiveReconciliation
          companyId={companyId}
          reconciliation={activeReconciliation}
          summary={activeSummary}
          currency={currencyByAccountId.get(activeReconciliation.bankAccountId) ?? "ZAR"}
          previewMode={previewMode}
        />
      )}

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
                    <span className="text-vf-ink">
                      {r.statementPeriodStart ? `${r.statementPeriodStart} → ` : ""}
                      {r.statementDate}
                    </span>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.monthEndLocked && <Badge tone="warn">Locked</Badge>}
                  </div>
                  <span className={`font-mono text-xs tabular-nums ${r.difference === 0 ? "text-vf-success" : "text-vf-danger"}`}>
                    {r.difference !== null ? formatMoney(r.difference, currencyByAccountId.get(r.bankAccountId) ?? "ZAR") : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
