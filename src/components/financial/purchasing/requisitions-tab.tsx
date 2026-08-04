"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChevronDown, IconChevronLeft, IconFileText, IconPlus } from "@/components/ui/icons";
import type { Supplier } from "@/server/accounting/types";
import type { PurchaseRequisition, PurchaseRequisitionStatus } from "@/server/purchasing/types";

const STATUS_OPTIONS: (PurchaseRequisitionStatus | "All")[] = ["All", "Draft", "Submitted", "Approved", "Rejected", "Converted"];
const STATUS_TONE: Record<PurchaseRequisitionStatus, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "good",
  Rejected: "danger",
  Converted: "warn",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type EditableLine = { description: string; quantity: string; estimatedUnitPrice: string };
const BLANK_LINE: EditableLine = { description: "", quantity: "1", estimatedUnitPrice: "" };

function RequisitionFormPanel({ companyId, onDone, onCancel }: { companyId: string; onDone: () => void; onCancel: () => void }) {
  const [requestedBy, setRequestedBy] = useState("");
  const [requisitionDate, setRequisitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<EditableLine[]>([{ ...BLANK_LINE }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.round(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.estimatedUnitPrice) || 0), 0) * 100) / 100;

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/requisitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedBy,
          requisitionDate,
          lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, estimatedUnitPrice: Number(l.estimatedUnitPrice) || 0 })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Purchase Requisition</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Requested By" htmlFor="pr-requester">
          <Input id="pr-requester" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
        </Field>
        <Field label="Requisition Date" htmlFor="pr-date" required>
          <Input id="pr-date" type="date" value={requisitionDate} onChange={(e) => setRequisitionDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input placeholder="Description" aria-label={`Description for line ${i + 1}`} value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
            </div>
            <div className="w-24">
              <Input type="number" step="0.01" placeholder="Qty" aria-label={`Quantity for line ${i + 1}`} value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
            </div>
            <div className="w-36">
              <Input type="number" step="0.01" placeholder="Est. Unit Price" aria-label={`Estimated unit price for line ${i + 1}`} value={line.estimatedUnitPrice} onChange={(e) => updateLine(i, { estimatedUnitPrice: e.target.value })} />
            </div>
            <Button variant="subtle" size="sm" disabled={lines.length <= 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="subtle" size="sm" className="w-fit" onClick={() => setLines((prev) => [...prev, { ...BLANK_LINE }])}>
          <IconPlus className="h-4 w-4" /> Add Line
        </Button>
      </div>

      <p className="mt-3 font-mono text-sm font-semibold tabular-nums text-vf-ink">Estimated Total: {money(total)}</p>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || total <= 0} onClick={submit}>
          Create Requisition
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

function ConvertToOrderPanel({
  companyId,
  requisition,
  suppliers,
  onDone,
  onCancel,
}: {
  companyId: string;
  requisition: PurchaseRequisition;
  suppliers: Supplier[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? 0);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requisitionId: requisition.id, supplierId, orderDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-vf-sm border border-vf-paper-border p-3">
      <div className="w-56">
        <Field label="Supplier" htmlFor={`pr-convert-supplier-${requisition.id}`} required>
          <Select id={`pr-convert-supplier-${requisition.id}`} value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="w-40">
        <Field label="Order Date" htmlFor={`pr-convert-date-${requisition.id}`} required>
          <Input id={`pr-convert-date-${requisition.id}`} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
      </div>
      <Button variant="primary" size="sm" disabled={loading || !supplierId} onClick={submit}>
        Convert
      </Button>
      <Button variant="subtle" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function RequisitionsTab({
  companyId,
  requisitions,
  suppliers,
  previewMode,
}: {
  companyId: string;
  requisitions: PurchaseRequisition[];
  suppliers: Supplier[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/purchasing/requisitions`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const term = search.trim().toLowerCase();
  const filtered = requisitions.filter((r) => {
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    if (!term) return true;
    return r.requisitionNumber.toLowerCase().includes(term) || r.requestedBy.toLowerCase().includes(term);
  });

  async function runAction(id: number, action: "submit" | "approve" | "reject") {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search requisition #, requester…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search requisitions" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Requisition
        </Button>
      </div>

      {showForm && <RequisitionFormPanel companyId={companyId} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No requisitions." description="No purchase requisitions match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Requisition #</TableHeadCell>
              <TableHeadCell>Requested By</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell className="text-right">Estimated Total</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((r) => {
              const isExpanded = expandedId === r.id;
              const total = r.lines.reduce((sum, l) => sum + l.lineTotal, 0);
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${r.requisitionNumber}` : `Expand ${r.requisitionNumber}`} onClick={() => setExpandedId(isExpanded ? null : r.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{r.requisitionNumber}</TableCell>
                    <TableCell>{r.requestedBy || "—"}</TableCell>
                    <TableCell>{r.requisitionDate}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(total)}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {r.status === "Draft" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === r.id} title={disabledTitle} onClick={() => runAction(r.id, "submit")}>
                            Submit
                          </Button>
                        )}
                        {r.status === "Submitted" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === r.id} title={disabledTitle} onClick={() => runAction(r.id, "approve")}>
                              Approve
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === r.id} title={disabledTitle} onClick={() => runAction(r.id, "reject")}>
                              Reject
                            </Button>
                          </>
                        )}
                        {r.status === "Approved" && (
                          <Button variant="primary" size="sm" disabled={previewMode || suppliers.length === 0} title={disabledTitle} onClick={() => setConvertingId(convertingId === r.id ? null : r.id)}>
                            Convert to Order
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {convertingId === r.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <ConvertToOrderPanel companyId={companyId} requisition={r} suppliers={suppliers} onDone={() => { setConvertingId(null); router.refresh(); }} onCancel={() => setConvertingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <table className="w-full text-xs">
                          <tbody>
                            {r.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.quantity}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(line.estimatedUnitPrice)}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{money(line.lineTotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
