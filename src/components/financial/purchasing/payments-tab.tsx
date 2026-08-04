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
import type { ImportedBill, Supplier } from "@/server/accounting/types";
import type { SupplierPayment, SupplierPaymentStatus } from "@/server/purchasing/types";

const STATUS_TONE: Record<SupplierPaymentStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function PaymentFormPanel({ companyId, suppliers, onDone, onCancel }: { companyId: string; suppliers: Supplier[]; onDone: () => void; onCancel: () => void }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? 0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, paymentDate, amount: Number(amount) || 0, reference }),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Supplier Payment</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Supplier" htmlFor="sp-supplier" required>
          <Select id="sp-supplier" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Payment Date" htmlFor="sp-date" required>
          <Input id="sp-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>
        <Field label="Amount" htmlFor="sp-amount" required>
          <Input id="sp-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reference" htmlFor="sp-ref">
          <Input id="sp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !supplierId || (Number(amount) || 0) <= 0} onClick={submit}>
          Create Payment
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

function AllocationPanel({
  companyId,
  payment,
  bills,
  onDone,
  onCancel,
}: {
  companyId: string;
  payment: SupplierPayment;
  bills: ImportedBill[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const alreadyAllocated = round2(payment.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  const remaining = round2(payment.amount - alreadyAllocated);
  const openBills = bills.filter((b) => b.supplierId === payment.supplierId && b.outstanding > 0);
  const [billId, setBillId] = useState(openBills[0]?.id ?? 0);
  const [amount, setAmount] = useState(String(remaining));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/payments/${payment.id}/allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId, amount: Number(amount) || 0 }),
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
      <p className="mb-1 text-sm font-semibold text-vf-ink">Allocate {payment.paymentNumber}</p>
      <p className="mb-3 text-xs text-vf-ink-faint">{money(remaining)} unallocated of {money(payment.amount)}</p>
      {openBills.length === 0 ? (
        <p className="text-sm text-vf-ink-faint">This supplier has no outstanding bills to allocate against.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Bill" htmlFor="al-bill" required>
              <Select id="al-bill" value={billId} onChange={(e) => setBillId(Number(e.target.value))}>
                {openBills.map((b) => (
                  <option key={b.id} value={b.id}>{b.invoiceNumber} — outstanding {money(b.outstanding)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="al-amount" required>
              <Input id="al-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" disabled={loading || !billId || (Number(amount) || 0) <= 0} onClick={submit}>
              Allocate
            </Button>
            <Button variant="subtle" size="sm" onClick={onCancel}>
              Close
            </Button>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function PaymentsTab({
  companyId,
  payments,
  suppliers,
  bills,
  previewMode,
}: {
  companyId: string;
  payments: SupplierPayment[];
  suppliers: Supplier[];
  bills: ImportedBill[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [allocatingId, setAllocatingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/purchasing/payments`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const supplierName = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;
  const billNumber = (id: number) => bills.find((b) => b.id === id)?.invoiceNumber ?? `#${id}`;

  const term = search.trim().toLowerCase();
  const filtered = term
    ? payments.filter((p) => p.paymentNumber.toLowerCase().includes(term) || supplierName(p.supplierId).toLowerCase().includes(term))
    : payments;

  async function runAction(id: number, action: "approve" | "retry-post" | "cancel") {
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
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search payment #, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search supplier payments" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || suppliers.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Payment
        </Button>
      </div>

      {showForm && <PaymentFormPanel companyId={companyId} suppliers={suppliers} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No supplier payments." description="No payments match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Payment #</TableHeadCell>
              <TableHeadCell>Supplier</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell className="text-right">Amount</TableHeadCell>
              <TableHeadCell className="text-right">Unallocated</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((p) => {
              const isExpanded = expandedId === p.id;
              const allocated = round2(p.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
              const unallocated = round2(p.amount - allocated);
              return (
                <Fragment key={p.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${p.paymentNumber}` : `Expand ${p.paymentNumber}`} onClick={() => setExpandedId(isExpanded ? null : p.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{p.paymentNumber}</TableCell>
                    <TableCell>{supplierName(p.supplierId)}</TableCell>
                    <TableCell>{p.paymentDate}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(p.amount)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(unallocated)}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {p.status === "Draft" && (
                          <>
                            <Button variant="primary" size="sm" disabled={previewMode || loadingId === p.id} title={disabledTitle} onClick={() => runAction(p.id, "approve")}>
                              Approve &amp; Post
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === p.id} title={disabledTitle} onClick={() => runAction(p.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {p.status === "Approved" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === p.id} title={disabledTitle} onClick={() => runAction(p.id, "retry-post")}>
                            Retry Posting
                          </Button>
                        )}
                        {p.status === "Posted" && unallocated > 0 && (
                          <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setAllocatingId(allocatingId === p.id ? null : p.id)}>
                            Allocate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {allocatingId === p.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-vf-paper-alt/40">
                        <AllocationPanel companyId={companyId} payment={p} bills={bills} onDone={() => { setAllocatingId(null); router.refresh(); }} onCancel={() => setAllocatingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-vf-paper-alt/40">
                        {p.allocations.length === 0 ? (
                          <p className="text-xs text-vf-ink-faint">No allocations yet.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody>
                              {p.allocations.map((a) => (
                                <tr key={a.id} className="border-b border-vf-paper-border/60">
                                  <td className="py-1 pr-2 font-mono text-vf-ink-soft">{billNumber(a.billId)}</td>
                                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(a.amountAllocated)}</td>
                                  <td className="py-1 text-right text-vf-ink-faint">{new Date(a.createdAt).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
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
