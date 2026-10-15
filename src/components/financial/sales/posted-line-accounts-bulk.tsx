"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/format";
import type { SalesInvoice } from "@/server/sales/types";
import type { PostedRepairPreview, PostedRepairResult } from "@/server/services/posted-line-account-repair-service";

/** Same page size the server enforces (MAX_POSTED_REPAIR_BATCH). */
export const REPAIR_PAGE_SIZE = 50;

/** A Posted invoice with at least one line without a revenue account — the
 * only kind of document the bulk repair can select. The server re-checks
 * everything (its journal in particular) before changing anything. */
export function isPostedRepairCandidate(invoice: SalesInvoice): boolean {
  return invoice.status === "Posted" && invoice.documentType === "Invoice" && invoice.lines.some((l) => !l.glAccount);
}

type Scope = { id: string; label: string; description: string; expected: { invoices: number; lines: number; total: number; vatAmount: number; journals: number } };

const OUTCOME_TONE: Record<PostedRepairResult["outcome"], "good" | "info" | "muted" | "danger"> = {
  repaired: "good",
  "already-repaired": "info",
  skipped: "muted",
  failed: "danger",
};

const money = (v: number) => `R${formatAmount(v)}`;

/**
 * Bulk "assign 1000 to missing revenue accounts" for Posted invoices: pick
 * invoices (or a pinned migration scope after its preflight), review the
 * counts and total, confirm, and see one result per invoice. Sends invoice
 * ids only, in pages of REPAIR_PAGE_SIZE; failures can be retried, and a
 * retry never repeats a repair that already succeeded.
 */
export function PostedLineAccountsBulkRepair({
  companyId,
  invoices,
  visibleInvoices,
  selected,
  onSelectedChange,
  previewMode,
  onDone,
}: {
  companyId: string;
  invoices: SalesInvoice[];
  visibleInvoices: SalesInvoice[];
  selected: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  previewMode: boolean;
  onDone: () => void;
}) {
  const candidates = invoices.filter(isPostedRepairCandidate);
  const visibleCandidates = visibleInvoices.filter(isPostedRepairCandidate);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopePreview, setScopePreview] = useState<PostedRepairPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PostedRepairResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/companies/${companyId}/sales/invoices/posted-line-accounts`;
  const hasCandidates = candidates.length > 0;

  useEffect(() => {
    if (!hasCandidates || previewMode) return;
    let cancelled = false;
    fetch(base)
      .then(async (res) => (res.ok ? ((await res.json()).scopes as Scope[]) : []))
      .then((s) => !cancelled && setScopes(s ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, hasCandidates, previewMode]);

  if (!hasCandidates && !results) return null;

  const chosen = invoices.filter((i) => selected.has(i.id));
  const chosenLines = chosen.reduce((t, i) => t + i.lines.filter((l) => !l.glAccount).length, 0);
  const chosenTotal = Math.round(chosen.reduce((t, i) => t + Math.round(i.total * 100), 0)) / 100;

  async function preflightScope(scopeId: string) {
    setError(null);
    setScopePreview(null);
    try {
      const res = await fetch(`${base}?scope=${encodeURIComponent(scopeId)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setScopePreview(data.preview);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    }
  }

  async function run(ids: number[]) {
    setRunning(true);
    setError(null);
    const all: PostedRepairResult[] = [];
    for (let i = 0; i < ids.length; i += REPAIR_PAGE_SIZE) {
      const page = ids.slice(i, i + REPAIR_PAGE_SIZE);
      try {
        const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceIds: page }) });
        const data = await res.json();
        if (!res.ok) {
          const message = data.error ?? `Request failed (${res.status})`;
          all.push(...page.map((id) => ({ invoiceId: id, invoiceNumber: invoices.find((x) => x.id === id)?.invoiceNumber ?? null, outcome: "failed" as const, linesAssigned: 0, message })));
        } else {
          all.push(...(data.results as PostedRepairResult[]));
        }
      } catch {
        all.push(...page.map((id) => ({ invoiceId: id, invoiceNumber: invoices.find((x) => x.id === id)?.invoiceNumber ?? null, outcome: "failed" as const, linesAssigned: 0, message: "Couldn't reach the API; nothing is known to have changed for this invoice. Retry it." })));
      }
    }
    setResults(all);
    onSelectedChange(new Set(all.filter((r) => r.outcome === "failed").map((r) => r.invoiceId)));
    setConfirming(false);
    setRunning(false);
    onDone();
  }

  const failed = results?.filter((r) => r.outcome === "failed") ?? [];
  const count = (o: PostedRepairResult["outcome"]) => results?.filter((r) => r.outcome === o).length ?? 0;

  return (
    <section aria-label="Repair missing revenue accounts" className="rounded-md border border-vf-paper-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-vf-danger">{candidates.length} posted invoice(s) have lines without a revenue account.</span>
        <Button variant="subtle" size="sm" disabled={visibleCandidates.length === 0} onClick={() => onSelectedChange(new Set([...selected, ...visibleCandidates.map((i) => i.id)]))}>
          Select all eligible results ({visibleCandidates.length})
        </Button>
        <Button variant="subtle" size="sm" disabled={selected.size === 0} onClick={() => onSelectedChange(new Set())}>
          Clear selection
        </Button>
        {scopes.map((s) => (
          <Button key={s.id} variant="subtle" size="sm" disabled={previewMode} onClick={() => preflightScope(s.id)}>
            Preflight: {s.label}
          </Button>
        ))}
      </div>

      <p className="mt-2" aria-live="polite">
        Selected: <strong>{chosen.length}</strong> invoice(s), <strong>{chosenLines}</strong> line(s) without an account, invoice total <strong>{money(chosenTotal)}</strong>.
      </p>
      <Button className="mt-2" variant="primary" size="sm" disabled={previewMode || running || chosen.length === 0} onClick={() => setConfirming(true)}>
        Review repair…
      </Button>

      {scopePreview?.scope && (
        <div className="mt-3 rounded border border-vf-paper-border p-2" aria-label="Scope preflight">
          <p className="font-medium">{scopePreview.scope.label} — preflight</p>
          <p className="text-xs text-vf-ink-faint">{scopePreview.scope.description}</p>
          <p className="mt-1">
            Eligible now: {scopePreview.eligible.invoices} invoice(s), {scopePreview.eligible.lines} line(s), total {money(scopePreview.eligible.total)}, VAT {money(scopePreview.eligible.vatAmount)}.
            Expected: {scopePreview.scope.expected.invoices} invoice(s), {scopePreview.scope.expected.lines} line(s), total {money(scopePreview.scope.expected.total)}, VAT {money(scopePreview.scope.expected.vatAmount)}.
            Journals: {scopePreview.journalCount} (expected {scopePreview.scope.expected.journals}). Account: {scopePreview.account.code} — {scopePreview.account.description ?? "missing"}
            {scopePreview.account.problem ? ` (${scopePreview.account.problem})` : ""}.
          </p>
          {scopePreview.scope.problems.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-vf-danger">
              {scopePreview.scope.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-vf-ink-soft">Every pinned invoice, journal and figure matches.</p>
          )}
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Invoice</TableHeadCell>
                <TableHeadCell>Journal</TableHeadCell>
                <TableHeadCell className="text-right">Total</TableHeadCell>
                <TableHeadCell className="text-right">VAT</TableHeadCell>
                <TableHeadCell className="text-right">Lines without account</TableHeadCell>
                <TableHeadCell>State</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {scopePreview.candidates.map((c) => (
                <TableRow key={c.invoiceId}>
                  <TableCell className="font-mono text-xs">{c.invoiceNumber ?? `#${c.invoiceId}`}</TableCell>
                  <TableCell className="font-mono text-xs">{c.journalNumber ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatAmount(c.total)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatAmount(c.vatAmount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{c.missingLines} of {c.lineCount}</TableCell>
                  <TableCell>{c.eligible ? "Eligible" : c.alreadyRepaired ? "Already repaired" : c.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button
            className="mt-2"
            variant="subtle"
            size="sm"
            disabled={!scopePreview.ready}
            onClick={() => onSelectedChange(new Set(scopePreview.candidates.filter((c) => c.eligible).map((c) => c.invoiceId)))}
          >
            Select exactly these {scopePreview.eligible.invoices} invoice(s)
          </Button>
        </div>
      )}

      {confirming && (
        <div role="alertdialog" aria-label="Confirm account repair" className="mt-3 rounded border border-vf-paper-border p-3">
          <p>
            Set the revenue account of the <strong>{chosenLines}</strong> line(s) without one, on <strong>{chosen.length}</strong> posted invoice(s) totalling{" "}
            <strong>{money(chosenTotal)}</strong>, to <strong>1000 — Product Sales</strong>.
          </p>
          <p className="mt-1">
            Only lines with no account change; a line that already has an account is never changed. Journals, invoice amounts, VAT, outstanding balances and invoice
            statuses do not change.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" size="sm" disabled={running || previewMode} onClick={() => run(chosen.map((i) => i.id))}>
              {running ? "Repairing…" : `Assign 1000 to ${chosenLines} line(s)`}
            </Button>
            <Button variant="subtle" size="sm" disabled={running} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-vf-danger">{error}</p>}

      {results && (
        <div className="mt-3" aria-label="Repair results">
          <p>
            Repaired {count("repaired")}, already repaired {count("already-repaired")}, skipped {count("skipped")}, failed {count("failed")}; {results.reduce((t, r) => t + r.linesAssigned, 0)} line(s) set to 1000.
          </p>
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Invoice</TableHeadCell>
                <TableHeadCell>Result</TableHeadCell>
                <TableHeadCell>Detail</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.invoiceId}>
                  <TableCell className="font-mono text-xs">{r.invoiceNumber ?? `#${r.invoiceId}`}</TableCell>
                  <TableCell><Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge></TableCell>
                  <TableCell className="text-xs">{r.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {failed.length > 0 && (
            <Button className="mt-2" variant="subtle" size="sm" disabled={previewMode || running} onClick={() => { onSelectedChange(new Set(failed.map((r) => r.invoiceId))); setConfirming(true); }}>
              Retry failed ({failed.length})
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
