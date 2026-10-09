"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionRow } from "@/components/ui/confirm-action";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/format";
import {
  sumAmounts,
  validateDateRange,
  type UnallocationCandidate,
  type UnallocationPreview,
  type UnallocationResult,
} from "@/server/banking/bulk-unallocation";

type BankAccountOption = { id: number; accountName: string };

export interface BulkUnallocateProps {
  companyId: string;
  bankAccounts: BankAccountOption[];
  /** The page's own Banking:Edit answer; the API and database enforce it regardless. */
  canEdit: boolean;
  previewMode: boolean;
}

function newRequestKey(): string {
  return crypto.randomUUID();
}

function glLabel(c: Pick<UnallocationCandidate, "glAccountCode" | "glAccountName">): string {
  if (!c.glAccountCode) return "—";
  return c.glAccountName ? `${c.glAccountCode} — ${c.glAccountName}` : c.glAccountCode;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * PREVIEW -> SELECT -> CONFIRM -> RESULT. Each preview carries its own
 * request key, so one preview can be executed once; changing the range or
 * the bank account discards the preview rather than executing a selection
 * against criteria it was not built from.
 */
export function BulkUnallocate({ companyId, bankAccounts, canEdit, previewMode }: BulkUnallocateProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [preview, setPreview] = useState<UnallocationPreview | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [result, setResult] = useState<UnallocationResult | null>(null);

  const disabled = previewMode || !canEdit;
  const rangeError = dateFrom && dateTo ? validateDateRange(dateFrom, dateTo) : null;

  const eligible = useMemo(() => (preview?.candidates ?? []).filter((c) => c.exclusionReason === null), [preview]);
  const excluded = useMemo(() => (preview?.candidates ?? []).filter((c) => c.exclusionReason !== null), [preview]);
  const selected = useMemo(() => eligible.filter((c) => selectedIds.has(c.id)), [eligible, selectedIds]);
  const selectedTotal = sumAmounts(selected);

  function resetPreview() {
    setPreview(null);
    setRequestKey(null);
    setSelectedIds(new Set());
    setConfirming(false);
    setExecuteError(null);
  }

  function changeCriteria(update: () => void) {
    update();
    resetPreview();
    setResult(null);
  }

  async function runPreview() {
    const problem = validateDateRange(dateFrom, dateTo);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    resetPreview();
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk-unallocate/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, bankAccountId: bankAccountId || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The preview could not be built.");
        return;
      }
      setPreview(body.preview as UnallocationPreview);
      setRequestKey(newRequestKey());
    } catch {
      setError("The preview could not be built. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  async function runExecute() {
    if (!preview || !requestKey || selected.length === 0) return;
    setExecuting(true);
    setExecuteError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk-unallocate/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey,
          dateFrom: preview.dateFrom,
          dateTo: preview.dateTo,
          bankAccountId: preview.bankAccountId,
          items: selected.map((c) => ({ id: c.id, glAccount: c.glAccountCode ?? "" })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExecuteError(body.error ?? "Nothing was unallocated.");
        return;
      }
      setResult(body.result as UnallocationResult);
      resetPreview();
    } catch {
      // The request may or may not have reached the server; the request key
      // makes a retry of this same preview safe (a repeat is refused).
      setExecuteError("The request did not complete. Check the result before trying again — repeating this preview is refused if it already ran.");
    } finally {
      setExecuting(false);
    }
  }

  const problems = result ? result.items.filter((i) => i.outcome !== "unallocated") : [];

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && !previewMode && (
        <p className="text-xs text-vf-ink-faint">
          You can view this page, but unallocating bank transactions needs the Banking Edit permission.
        </p>
      )}

      {/* CRITERIA */}
      <div className="flex flex-col gap-3 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="bu-date-from" className="mb-1 block text-xs font-medium text-vf-ink-soft">From Date</label>
            <Input id="bu-date-from" type="date" value={dateFrom} onChange={(e) => changeCriteria(() => setDateFrom(e.target.value))} />
          </div>
          <div>
            <label htmlFor="bu-date-to" className="mb-1 block text-xs font-medium text-vf-ink-soft">To Date</label>
            <Input id="bu-date-to" type="date" value={dateTo} onChange={(e) => changeCriteria(() => setDateTo(e.target.value))} />
          </div>
          <div className="min-w-[200px]">
            <label htmlFor="bu-bank" className="mb-1 block text-xs font-medium text-vf-ink-soft">Bank account</label>
            <Select id="bu-bank" value={bankAccountId} onChange={(e) => changeCriteria(() => setBankAccountId(e.target.value))}>
              <option value="">All bank accounts</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="primary" size="sm" disabled={disabled || loading || !dateFrom || !dateTo || rangeError !== null} onClick={runPreview}>
            {loading ? "Building preview…" : "Preview"}
          </Button>
        </div>
        <p className="text-xs text-vf-ink-faint">
          Uses each transaction&apos;s own transaction date (both dates included) — not the date it was imported or allocated.
        </p>
        {rangeError && <p className="text-sm text-vf-danger">{rangeError}</p>}
        {error && !rangeError && <p className="text-sm text-vf-danger">{error}</p>}
      </div>

      {/* RESULT */}
      {result && (
        <div role="status" className="flex flex-col gap-2 rounded-vf-lg bg-vf-paper p-4 text-sm shadow-vf-paper-lg sm:p-5">
          <p className="font-medium text-vf-ink">
            {plural(result.requested, "transaction")} processed · {result.unallocated} unallocated · {result.skipped} skipped · {result.failed} failed
          </p>
          {result.unallocated > 0 && (
            <p className="text-vf-ink-soft">
              Each unallocated transaction keeps its previous GL account beside it in the Transaction Explorer, ready for review. Nothing was posted or
              re-allocated.
            </p>
          )}
          {problems.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-vf-ink-soft">
              {problems.map((p) => (
                <li key={p.transactionId}>
                  <Badge tone={p.outcome === "failed" ? "danger" : "muted"}>{p.outcome === "failed" ? "Failed" : "Skipped"}</Badge>{" "}
                  #{p.transactionId}
                  {p.glAccount ? ` (${p.glAccount})` : ""}: {p.reason}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-vf-ink-faint">Audit reference: run #{result.runId}.</p>
        </div>
      )}

      {/* REVIEW + SELECT + CONFIRM */}
      {preview && (
        <div className="flex flex-col gap-3 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-vf-ink">
              {plural(eligible.length, "eligible transaction")} · {excluded.length} excluded
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="subtle"
                size="sm"
                disabled={disabled || eligible.length === 0}
                onClick={() => {
                  setSelectedIds(new Set(eligible.map((c) => c.id)));
                  setConfirming(false);
                }}
              >
                Select all eligible
              </Button>
              <Button
                variant="subtle"
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  setSelectedIds(new Set());
                  setConfirming(false);
                }}
              >
                Clear
              </Button>
            </div>
          </div>

          {preview.truncated && (
            <p className="text-xs text-vf-warning">
              This range holds more allocated transactions than one run can take. Only the first {preview.candidates.length} are shown — narrow the date range
              to see the rest.
            </p>
          )}

          <p className="text-sm text-vf-ink-soft" aria-live="polite">
            Selected: {plural(selected.length, "transaction")} · total value R{formatAmount(selectedTotal)}
          </p>

          <div className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border bg-vf-canvas/40 p-3">
            <p className="text-xs text-vf-ink-soft">
              Unallocating removes the allocation and returns each transaction to Unallocated. Its current GL account is kept beside it for the next review
              — it is not an allocation and nothing posts from it. No journal, payment or GL entry is created, and nothing is re-allocated automatically.
            </p>
            <div>
              <Button variant="primary" size="sm" disabled={disabled || selected.length === 0 || executing} onClick={() => setConfirming(true)}>
                Unallocate selected
              </Button>
            </div>
            {selected.length === 0 && <p className="text-xs text-vf-ink-faint">Select at least one eligible transaction.</p>}
            {confirming && selected.length > 0 && (
              <ConfirmActionRow
                layout="panel"
                tone="danger"
                loading={executing}
                error={executeError}
                confirmLabel={`Unallocate ${plural(selected.length, "transaction")}`}
                confirmingLabel="Unallocating…"
                onConfirm={runExecute}
                onCancel={() => setConfirming(false)}
                message={`Unallocate ${plural(selected.length, "transaction")} totalling R${formatAmount(selectedTotal)}, dated ${preview.dateFrom} to ${preview.dateTo}?`}
                itemsPreview={
                  <p className="text-xs">
                    Each one is re-checked on the server first; anything posted, reconciled or changed since this preview is skipped and reported.
                  </p>
                }
              />
            )}
            {!confirming && executeError && <p className="text-xs text-vf-danger">{executeError}</p>}
          </div>

          {preview.candidates.length === 0 ? (
            <p className="text-sm text-vf-ink-faint">No allocated transactions are dated in this range.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeadCell>
                    <span className="sr-only">Select</span>
                  </TableHeadCell>
                  <TableHeadCell>Date</TableHeadCell>
                  <TableHeadCell>Description</TableHeadCell>
                  <TableHeadCell>Reference</TableHeadCell>
                  <TableHeadCell className="text-right">Amount</TableHeadCell>
                  <TableHeadCell>Current GL account</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                  <TableHeadCell>Eligibility</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody>
                {preview.candidates.map((c) => {
                  const isEligible = c.exclusionReason === null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.description || `transaction ${c.id}`}`}
                          checked={selectedIds.has(c.id)}
                          disabled={disabled || !isEligible}
                          onChange={() => toggle(c.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{c.transactionDate}</TableCell>
                      <TableCell>{c.description || "—"}</TableCell>
                      <TableCell>{c.reference || "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatAmount(c.amount)}</TableCell>
                      <TableCell>{glLabel(c)}</TableCell>
                      <TableCell>
                        <Badge tone={c.allocationStatus === "Unallocated" ? "muted" : "good"}>{c.allocationStatus}</Badge>
                      </TableCell>
                      <TableCell>
                        {isEligible ? <Badge tone="info">Eligible</Badge> : <span className="text-xs text-vf-ink-soft">Excluded: {c.exclusionReason}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
