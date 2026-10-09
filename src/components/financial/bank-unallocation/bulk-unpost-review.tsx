"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionRow } from "@/components/ui/confirm-action";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/format";
import {
  allocationLabel,
  sumAmounts,
  toggleJournalGroup,
  toUnpostingItem,
  type UnpostingPreview,
  type UnpostingResult,
} from "@/server/banking/bulk-unallocation";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function postingLabel(sourceType: string | null): string {
  if (sourceType === "bank_transactions_post") return "Post to Accounting";
  if (sourceType === "bank_transaction_rule_engine") return "Banking Rule";
  return sourceType ?? "—";
}

export interface BulkUnpostReviewProps {
  companyId: string;
  preview: UnpostingPreview;
  requestKey: string;
  disabled: boolean;
  onDone: (result: UnpostingResult) => void;
}

/**
 * SELECT -> CONFIRM for POSTED transactions (migration 0120). A posting is
 * reversed a whole journal at a time, so selecting one transaction selects
 * every eligible transaction posted on the same journal, and clearing one
 * clears them all — the screen never offers a selection the database would
 * refuse.
 */
export function BulkUnpostReview({ companyId, preview, requestKey, disabled, onDone }: BulkUnpostReviewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const eligible = useMemo(() => preview.candidates.filter((c) => c.exclusionReason === null), [preview]);
  const excluded = useMemo(() => preview.candidates.filter((c) => c.exclusionReason !== null), [preview]);
  const selected = useMemo(() => eligible.filter((c) => selectedIds.has(c.id)), [eligible, selectedIds]);
  const selectedTotal = sumAmounts(selected);
  const selectedJournals = useMemo(() => new Set(selected.map((c) => c.journalId)).size, [selected]);

  async function runExecute() {
    if (selected.length === 0) return;
    setExecuting(true);
    setExecuteError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/bulk-unallocate/posted/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey,
          dateFrom: preview.dateFrom,
          dateTo: preview.dateTo,
          bankAccountId: preview.bankAccountId,
          items: selected.map(toUnpostingItem),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExecuteError(body.error ?? "Nothing was unposted.");
        return;
      }
      onDone(body.result as UnpostingResult);
    } catch {
      setExecuteError("The request did not complete. Check the result before trying again — repeating this preview is refused if it already ran.");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-vf-lg bg-vf-paper p-4 shadow-vf-paper-lg sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-vf-ink">
          {plural(eligible.length, "eligible posted transaction")} · {excluded.length} excluded
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
          This range holds more posted transactions than one run can take. Only the first {preview.candidates.length} are shown — narrow the date range to
          see the rest.
        </p>
      )}

      <p className="text-sm text-vf-ink-soft" aria-live="polite">
        Selected: {plural(selected.length, "transaction")} on {plural(selectedJournals, "journal")} · total value R{formatAmount(selectedTotal)}
      </p>

      <div className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border bg-vf-canvas/40 p-3">
        <p className="text-xs text-vf-ink-soft">
          Unposting reverses each selected transaction&apos;s journal with a reversal journal dated on the original journal&apos;s own date, so that period
          nets to zero, then returns the transaction to Unallocated. Its GL account, customer or supplier is kept beside it for review — it is not an
          allocation and nothing posts from it. Transactions posted on the same journal are always selected and reversed together.
        </p>
        <div>
          <Button variant="primary" size="sm" disabled={disabled || selected.length === 0 || executing} onClick={() => setConfirming(true)}>
            Unpost and unallocate selected
          </Button>
        </div>
        {selected.length === 0 && <p className="text-xs text-vf-ink-faint">Select at least one eligible transaction.</p>}
        {confirming && selected.length > 0 && (
          <ConfirmActionRow
            layout="panel"
            tone="danger"
            loading={executing}
            error={executeError}
            confirmLabel={`Unpost ${plural(selected.length, "transaction")}`}
            confirmingLabel="Unposting…"
            onConfirm={runExecute}
            onCancel={() => setConfirming(false)}
            message={`Reverse ${plural(selectedJournals, "journal")} and unpost ${plural(selected.length, "transaction")} totalling R${formatAmount(selectedTotal)}, dated ${preview.dateFrom} to ${preview.dateTo}?`}
            itemsPreview={
              <p className="text-xs">
                Each journal is re-checked on the server first and reversed whole or not at all; anything reconciled, in a closed or locked period, or changed
                since this preview is skipped and reported.
              </p>
            }
          />
        )}
        {!confirming && executeError && <p className="text-xs text-vf-danger">{executeError}</p>}
      </div>

      {preview.candidates.length === 0 ? (
        <p className="text-sm text-vf-ink-faint">No posted transactions are dated in this range.</p>
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
              <TableHeadCell>Allocated to (kept)</TableHeadCell>
              <TableHeadCell>Posted on</TableHeadCell>
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
                      onChange={() => {
                        setSelectedIds((current) => toggleJournalGroup(current, preview.candidates, c.id));
                        setConfirming(false);
                      }}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{c.transactionDate}</TableCell>
                  <TableCell>{c.description || "—"}</TableCell>
                  <TableCell>{c.reference || "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatAmount(c.amount)}</TableCell>
                  <TableCell>{allocationLabel(c)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {c.journalNumber ?? "—"}
                    <span className="block text-xs text-vf-ink-faint">
                      {postingLabel(c.journalSourceType)}
                      {c.journalTransactionCount > 1 ? ` · ${plural(c.journalTransactionCount, "transaction")} together` : ""}
                    </span>
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
  );
}

/** The outcome of a run, per transaction, with the reversal references. */
export function BulkUnpostResult({ result }: { result: UnpostingResult }) {
  const problems = result.items.filter((i) => i.outcome !== "unposted");
  const reversals = [...new Map(result.items.filter((i) => i.outcome === "unposted").map((i) => [i.journalNumber, i.reversalJournalNumber])).entries()];
  return (
    <div role="status" className="flex flex-col gap-2 rounded-vf-lg bg-vf-paper p-4 text-sm shadow-vf-paper-lg sm:p-5">
      <p className="font-medium text-vf-ink">
        {plural(result.requested, "transaction")} processed · {result.unposted} unposted ({plural(result.reversedJournals, "journal")} reversed) ·{" "}
        {result.skipped} skipped · {result.failed} failed
      </p>
      {result.unposted > 0 && (
        <p className="text-vf-ink-soft">
          Each unposted transaction is back to Unallocated and keeps its previous GL account, customer or supplier beside it in the Transaction Explorer,
          ready to edit and post again. Nothing was re-allocated.
        </p>
      )}
      {reversals.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-vf-ink-soft">
          {reversals.map(([original, reversal]) => (
            <li key={original}>
              {original} reversed by {reversal}
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-vf-ink-soft">
          {problems.map((p) => (
            <li key={p.transactionId}>
              <Badge tone={p.outcome === "failed" ? "danger" : "muted"}>{p.outcome === "failed" ? "Failed" : "Skipped"}</Badge> #{p.transactionId}
              {p.journalNumber ? ` (${p.journalNumber})` : ""}: {p.reason}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-vf-ink-faint">Audit reference: run #{result.runId}.</p>
    </div>
  );
}
