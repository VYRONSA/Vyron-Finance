"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { CustomerMatchingWorkspaceData } from "@/server/services/customer-matching-service";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SUB_TABS = ["Invoices", "Credit Notes", "Debit Notes", "Receipts", "Suggestions", "Statement"] as const;
type SubTab = (typeof SUB_TABS)[number];

function DocumentTable({ rows }: { rows: { id: number; invoiceNumber: string; invoiceDate: string; total: number; outstanding: number; status: string }[] }) {
  if (rows.length === 0) return <EmptyState title="Nothing here yet." description="Documents will appear once real Sales activity exists." />;
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Document</TableHeadCell>
          <TableHeadCell>Date</TableHeadCell>
          <TableHeadCell className="text-right">Total</TableHeadCell>
          <TableHeadCell className="text-right">Outstanding</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium text-vf-ink">{r.invoiceNumber}</TableCell>
            <TableCell>{r.invoiceDate}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(r.total)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(r.outstanding)}</TableCell>
            <TableCell>
              <Badge tone={r.status === "Posted" ? "good" : "muted"}>{r.status}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReceiptsTable({ receipts }: { receipts: CustomerMatchingWorkspaceData["receipts"] }) {
  if (receipts.length === 0) return <EmptyState title="No receipts yet." description="Receipts will appear once real Sales activity exists." />;
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Receipt</TableHeadCell>
          <TableHeadCell>Date</TableHeadCell>
          <TableHeadCell className="text-right">Amount</TableHeadCell>
          <TableHeadCell className="text-right">Allocated</TableHeadCell>
          <TableHeadCell className="text-right">Unallocated</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {receipts.map((r) => {
          const allocated = r.allocations.reduce((sum, a) => sum + a.amountAllocated, 0);
          return (
            <TableRow key={r.id}>
              <TableCell className="font-medium text-vf-ink">{r.receiptNumber}</TableCell>
              <TableCell>{r.receiptDate}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(r.amount)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(allocated)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(r.amount - allocated)}</TableCell>
              <TableCell>
                <Badge tone={r.status === "Posted" ? "good" : "muted"}>{r.status}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SuggestionsPanel({ companyId, data, previewMode }: { companyId: string; data: CustomerMatchingWorkspaceData; previewMode: boolean }) {
  const router = useRouter();
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoResult, setAutoResult] = useState<{ allocated: number; totalAmount: number; failures: string[] } | null>(null);
  const [manualAmount, setManualAmount] = useState<Record<string, string>>({});
  const [manualLoading, setManualLoading] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const receiptById = useMemo(() => new Map(data.receipts.map((r) => [r.id, r])), [data.receipts]);
  const invoiceById = useMemo(() => new Map(data.invoices.map((i) => [i.id, i])), [data.invoices]);

  async function runAuto() {
    setAutoRunning(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/customers/auto-allocate`, { method: "POST" });
      const body = await res.json();
      setAutoResult(body.outcome);
      router.refresh();
    } finally {
      setAutoRunning(false);
    }
  }

  async function manualAllocate(receiptId: number, invoiceId: number) {
    const key = `${receiptId}-${invoiceId}`;
    const amount = Number(manualAmount[key]);
    if (!amount || amount <= 0) return;
    setManualLoading(key);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/customers/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId, invoiceId, amount }),
      });
      if (res.ok) router.refresh();
    } finally {
      setManualLoading(null);
    }
  }

  const matchedCount = data.candidates.filter((c) => c.band === "Matched").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" disabled={previewMode || autoRunning || matchedCount === 0} title={disabledTitle} onClick={runAuto}>
          {autoRunning ? "Running…" : `Auto Match ${matchedCount} High-Confidence Pair(s)`}
        </Button>
        {autoResult && (
          <span className="text-sm text-vf-ink-soft">
            Allocated {autoResult.allocated} pair(s) totalling {money(autoResult.totalAmount)}
            {autoResult.failures.length > 0 && ` — ${autoResult.failures.length} failed`}.
          </span>
        )}
      </div>

      {data.candidates.length === 0 ? (
        <EmptyState title="No suggested matches." description="AI Suggestions appear once a Posted receipt has unallocated funds and an outstanding invoice exists for the same customer." />
      ) : (
        <div className="flex flex-col gap-2">
          {data.candidates.map((c) => {
            const key = `${c.receiptId}-${c.invoiceId}`;
            const receipt = receiptById.get(c.receiptId);
            const invoice = invoiceById.get(c.invoiceId);
            return (
              <div key={key} className="rounded-vf-md border border-vf-paper-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={c.band === "Matched" ? "good" : c.band === "Suggested" ? "warn" : "muted"}>{c.score}% confidence</Badge>
                      <span className="text-sm text-vf-ink">
                        {receipt?.receiptNumber ?? `Receipt ${c.receiptId}`} → {invoice?.invoiceNumber ?? `Invoice ${c.invoiceId}`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-vf-ink-faint">
                      {c.matchedRules.map((r) => r.label).join(", ") || "No rules fired"} — suggested amount {money(c.suggestedAmount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-28">
                      <Input
                        aria-label={`Manual allocation amount for ${key}`}
                        type="number"
                        value={manualAmount[key] ?? String(c.suggestedAmount)}
                        onChange={(e) => setManualAmount((m) => ({ ...m, [key]: e.target.value }))}
                      />
                    </div>
                    <Button variant="subtle" size="sm" disabled={previewMode || manualLoading !== null} title={disabledTitle} onClick={() => manualAllocate(c.receiptId, c.invoiceId)}>
                      {manualLoading === key ? "Allocating…" : "Allocate"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatementPanel({ companyId, data, previewMode }: { companyId: string; data: CustomerMatchingWorkspaceData; previewMode: boolean }) {
  const customerIds = useMemo(() => {
    const ids = new Set<number>();
    for (const i of data.invoices) ids.add(i.customerId);
    for (const r of data.receipts) ids.add(r.customerId);
    return [...ids].sort((a, b) => a - b);
  }, [data]);

  const [customerId, setCustomerId] = useState<number | null>(customerIds[0] ?? null);
  const [entries, setEntries] = useState<StatementEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(id: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/customers/${id}/statement`);
      const data = await res.json();
      setEntries(data.statement);
    } finally {
      setLoading(false);
    }
  }

  if (customerIds.length === 0) {
    return <EmptyState title="No customer activity yet." description="A statement becomes available once a customer has Posted invoices or receipts." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="statement-customer" className="mb-1 block text-xs font-medium text-vf-ink-faint">Customer</label>
          <select
            id="statement-customer"
            value={customerId ?? ""}
            onChange={(e) => setCustomerId(Number(e.target.value))}
            className="min-w-[160px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            {customerIds.map((id) => (
              <option key={id} value={id}>
                Customer #{id}
              </option>
            ))}
          </select>
        </div>
        <Button variant="subtle" size="sm" disabled={previewMode || customerId === null || loading} onClick={() => customerId !== null && load(customerId)}>
          {loading ? "Loading…" : "Load Statement"}
        </Button>
      </div>

      {entries !== null && (
        entries.length === 0 ? (
          <EmptyState title="No statement activity." description="This customer has no Posted invoices or receipts." />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell>Reference</TableHeadCell>
                <TableHeadCell className="text-right">Debit</TableHeadCell>
                <TableHeadCell className="text-right">Credit</TableHeadCell>
                <TableHeadCell className="text-right">Balance</TableHeadCell>
              </tr>
            </TableHead>
            <TableBody>
              {entries.map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{e.date}</TableCell>
                  <TableCell>
                    <Badge tone="info">{e.type}</Badge>
                  </TableCell>
                  <TableCell>{e.reference}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{e.debit > 0 ? money(e.debit) : "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{e.credit > 0 ? money(e.credit) : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">{money(e.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}
    </div>
  );
}

/** "Build the complete Customer Matching workspace" — real Invoices,
 * Credit Notes, Debit Notes, and Receipts (all reused from Sales, never
 * re-fetched a second way), a real chronological Statement, and
 * Auto/Manual/AI-Suggested allocation, all routing through the SAME
 * `allocateReceipt` Sales already built. */
export function CustomerMatchingTab({ companyId, data, previewMode }: { companyId: string; data: CustomerMatchingWorkspaceData; previewMode: boolean }) {
  const [active, setActive] = useState<SubTab>("Suggestions");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active === t ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {active === "Invoices" && <DocumentTable rows={data.invoices} />}
      {active === "Credit Notes" && <DocumentTable rows={data.creditNotes} />}
      {active === "Debit Notes" && <DocumentTable rows={data.debitNotes} />}
      {active === "Receipts" && <ReceiptsTable receipts={data.receipts} />}
      {active === "Suggestions" && <SuggestionsPanel companyId={companyId} data={data} previewMode={previewMode} />}
      {active === "Statement" && <StatementPanel companyId={companyId} data={data} previewMode={previewMode} />}
    </div>
  );
}
