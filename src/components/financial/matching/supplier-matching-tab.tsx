"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import type { SupplierMatchingWorkspaceData } from "@/server/services/supplier-matching-service";
import type { StatementEntry } from "@/server/matching/supplier-statement-engine";
import type { PurchaseOrder, GoodsReceivedNote } from "@/server/purchasing/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SUB_TABS = ["Bills", "Credit Notes", "Debit Notes", "Payments", "Suggestions", "Purchase Orders / GRNs", "Statement"] as const;
type SubTab = (typeof SUB_TABS)[number];

function DocumentTable({ rows }: { rows: { id: number; invoiceNumber: string; invoiceDate: string | null; total: number; outstanding: number; status: string }[] }) {
  if (rows.length === 0) return <EmptyState title="Nothing here yet." description="Documents will appear once real Purchasing activity exists." />;
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
            <TableCell>{r.invoiceDate ?? "—"}</TableCell>
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

function PaymentsTable({ payments }: { payments: SupplierMatchingWorkspaceData["payments"] }) {
  if (payments.length === 0) return <EmptyState title="No payments yet." description="Payments will appear once real Purchasing activity exists." />;
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Payment</TableHeadCell>
          <TableHeadCell>Date</TableHeadCell>
          <TableHeadCell className="text-right">Amount</TableHeadCell>
          <TableHeadCell className="text-right">Allocated</TableHeadCell>
          <TableHeadCell className="text-right">Unallocated</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {payments.map((p) => {
          const allocated = p.allocations.reduce((sum, a) => sum + a.amountAllocated, 0);
          return (
            <TableRow key={p.id}>
              <TableCell className="font-medium text-vf-ink">{p.paymentNumber}</TableCell>
              <TableCell>{p.paymentDate}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(p.amount)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(allocated)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(p.amount - allocated)}</TableCell>
              <TableCell>
                <Badge tone={p.status === "Posted" ? "good" : "muted"}>{p.status}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SuggestionsPanel({ companyId, data, previewMode }: { companyId: string; data: SupplierMatchingWorkspaceData; previewMode: boolean }) {
  const router = useRouter();
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoResult, setAutoResult] = useState<{ allocated: number; totalAmount: number; failures: string[] } | null>(null);
  const [manualAmount, setManualAmount] = useState<Record<string, string>>({});
  const [manualLoading, setManualLoading] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const paymentById = useMemo(() => new Map(data.payments.map((p) => [p.id, p])), [data.payments]);
  const billById = useMemo(() => new Map(data.bills.map((b) => [b.id, b])), [data.bills]);

  async function runAuto() {
    setAutoRunning(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/suppliers/auto-allocate`, { method: "POST" });
      const body = await res.json();
      setAutoResult(body.outcome);
      router.refresh();
    } finally {
      setAutoRunning(false);
    }
  }

  async function manualAllocate(paymentId: number, billId: number) {
    const key = `${paymentId}-${billId}`;
    const amount = Number(manualAmount[key]);
    if (!amount || amount <= 0) return;
    setManualLoading(key);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/suppliers/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, billId, amount }),
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
        <EmptyState title="No suggested matches." description="AI Suggestions appear once a Posted payment has unallocated funds and an outstanding bill exists for the same supplier." />
      ) : (
        <div className="flex flex-col gap-2">
          {data.candidates.map((c) => {
            const key = `${c.paymentId}-${c.billId}`;
            const payment = paymentById.get(c.paymentId);
            const bill = billById.get(c.billId);
            return (
              <div key={key} className="rounded-vf-md border border-vf-paper-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={c.band === "Matched" ? "good" : c.band === "Suggested" ? "warn" : "muted"}>{c.score}% confidence</Badge>
                      <span className="text-sm text-vf-ink">
                        {payment?.paymentNumber ?? `Payment ${c.paymentId}`} → {bill?.invoiceNumber ?? `Bill ${c.billId}`}
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
                    <Button variant="subtle" size="sm" disabled={previewMode || manualLoading !== null} title={disabledTitle} onClick={() => manualAllocate(c.paymentId, c.billId)}>
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

function DocumentsPanel({ companyId, supplierIds }: { companyId: string; supplierIds: number[] }) {
  const [supplierId, setSupplierId] = useState<number | null>(supplierIds[0] ?? null);
  const [documents, setDocuments] = useState<{ purchaseOrders: PurchaseOrder[]; goodsReceivedNotes: GoodsReceivedNote[] } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(id: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/suppliers/${id}/documents`);
      const data = await res.json();
      setDocuments(data);
    } finally {
      setLoading(false);
    }
  }

  if (supplierIds.length === 0) {
    return <EmptyState title="No supplier activity yet." description="Purchase Orders and GRNs become visible once Purchasing activity exists." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="documents-supplier" className="mb-1 block text-xs font-medium text-vf-ink-faint">Supplier</label>
          <select
            id="documents-supplier"
            value={supplierId ?? ""}
            onChange={(e) => setSupplierId(Number(e.target.value))}
            className="min-w-[160px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            {supplierIds.map((id) => (
              <option key={id} value={id}>
                Supplier #{id}
              </option>
            ))}
          </select>
        </div>
        <Button variant="subtle" size="sm" disabled={supplierId === null || loading} onClick={() => supplierId !== null && load(supplierId)}>
          {loading ? "Loading…" : "Load Documents"}
        </Button>
      </div>

      {documents && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Purchase Orders — 3-way-match visibility, reused from Purchasing</p>
            {documents.purchaseOrders.length === 0 ? (
              <p className="text-xs text-vf-ink-faint">None.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-vf-ink-soft">
                {documents.purchaseOrders.map((po) => (
                  <li key={po.id}>
                    {po.orderNumber} — <Badge tone="info">{po.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Goods Received Notes</p>
            {documents.goodsReceivedNotes.length === 0 ? (
              <p className="text-xs text-vf-ink-faint">None.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-vf-ink-soft">
                {documents.goodsReceivedNotes.map((grn) => (
                  <li key={grn.id}>
                    {grn.grnNumber} — <Badge tone="info">{grn.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatementPanel({ companyId, data, previewMode }: { companyId: string; data: SupplierMatchingWorkspaceData; previewMode: boolean }) {
  const supplierIds = useMemo(() => {
    const ids = new Set<number>();
    for (const b of data.bills) if (b.supplierId !== null) ids.add(b.supplierId);
    for (const p of data.payments) ids.add(p.supplierId);
    return [...ids].sort((a, b) => a - b);
  }, [data]);

  const [supplierId, setSupplierId] = useState<number | null>(supplierIds[0] ?? null);
  const [entries, setEntries] = useState<StatementEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(id: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/matching/suppliers/${id}/statement`);
      const data = await res.json();
      setEntries(data.statement);
    } finally {
      setLoading(false);
    }
  }

  if (supplierIds.length === 0) {
    return <EmptyState title="No supplier activity yet." description="A statement becomes available once a supplier has real posted bills or payments." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="supplier-statement-select" className="mb-1 block text-xs font-medium text-vf-ink-faint">Supplier</label>
          <select
            id="supplier-statement-select"
            value={supplierId ?? ""}
            onChange={(e) => setSupplierId(Number(e.target.value))}
            className="min-w-[160px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            {supplierIds.map((id) => (
              <option key={id} value={id}>
                Supplier #{id}
              </option>
            ))}
          </select>
        </div>
        <Button variant="subtle" size="sm" disabled={previewMode || supplierId === null || loading} onClick={() => supplierId !== null && load(supplierId)}>
          {loading ? "Loading…" : "Load Statement"}
        </Button>
      </div>

      {entries !== null && (
        entries.length === 0 ? (
          <EmptyState title="No statement activity." description="This supplier has no real posted bills or payments." />
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

/** "Build the complete Supplier Matching workspace" — the AP mirror of
 * `customer-matching-tab.tsx`, plus read-only Purchase Order/GRN
 * visibility for the 3-way match, reused from the existing Purchasing
 * services rather than a second implementation. */
export function SupplierMatchingTab({ companyId, data, previewMode }: { companyId: string; data: SupplierMatchingWorkspaceData; previewMode: boolean }) {
  const [active, setActive] = useState<SubTab>("Suggestions");

  const supplierIds = useMemo(() => {
    const ids = new Set<number>();
    for (const b of data.bills) if (b.supplierId !== null) ids.add(b.supplierId);
    for (const p of data.payments) ids.add(p.supplierId);
    return [...ids].sort((a, b) => a - b);
  }, [data]);

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
      {active === "Bills" && <DocumentTable rows={data.bills} />}
      {active === "Credit Notes" && <DocumentTable rows={data.creditNotes} />}
      {active === "Debit Notes" && <DocumentTable rows={data.debitNotes} />}
      {active === "Payments" && <PaymentsTable payments={data.payments} />}
      {active === "Suggestions" && <SuggestionsPanel companyId={companyId} data={data} previewMode={previewMode} />}
      {active === "Purchase Orders / GRNs" && <DocumentsPanel companyId={companyId} supplierIds={supplierIds} />}
      {active === "Statement" && <StatementPanel companyId={companyId} data={data} previewMode={previewMode} />}
    </div>
  );
}
