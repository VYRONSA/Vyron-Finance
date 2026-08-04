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
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";
import { CommunicationHistoryPanel } from "@/components/financial/communications/communication-history-panel";
import type { Customer } from "@/server/customer-management/types";
import type { CustomerReceipt, CustomerReceiptStatus, SalesInvoice } from "@/server/sales/types";

const STATUS_TONE: Record<CustomerReceiptStatus, "muted" | "info" | "good" | "danger"> = {
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

function ReceiptFormPanel({ companyId, customers, onDone, onCancel }: { companyId: string; customers: Customer[]; onDone: () => void; onCancel: () => void }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? 0);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, receiptDate, amount: Number(amount) || 0, reference }),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Customer Receipt</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Customer" htmlFor="rc-customer" required>
          <Select id="rc-customer" value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.customerCode} — {c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Receipt Date" htmlFor="rc-date" required>
          <Input id="rc-date" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
        </Field>
        <Field label="Amount" htmlFor="rc-amount" required>
          <Input id="rc-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reference" htmlFor="rc-ref">
          <Input id="rc-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !customerId || (Number(amount) || 0) <= 0} onClick={submit}>
          Create Receipt
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
  receipt,
  invoices,
  onDone,
  onCancel,
}: {
  companyId: string;
  receipt: CustomerReceipt;
  invoices: SalesInvoice[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const alreadyAllocated = round2(receipt.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  const remaining = round2(receipt.amount - alreadyAllocated);
  const openInvoices = invoices.filter((i) => i.customerId === receipt.customerId && i.outstanding > 0 && i.status === "Posted");
  const [invoiceId, setInvoiceId] = useState(openInvoices[0]?.id ?? 0);
  const [amount, setAmount] = useState(String(remaining));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/receipts/${receipt.id}/allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, amount: Number(amount) || 0 }),
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
      <p className="mb-1 text-sm font-semibold text-vf-ink">Allocate {receipt.receiptNumber}</p>
      <p className="mb-3 text-xs text-vf-ink-faint">{money(remaining)} unallocated of {money(receipt.amount)}</p>
      {openInvoices.length === 0 ? (
        <p className="text-sm text-vf-ink-faint">This customer has no outstanding Posted invoices to allocate against.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Invoice" htmlFor="al-invoice" required>
              <Select id="al-invoice" value={invoiceId} onChange={(e) => setInvoiceId(Number(e.target.value))}>
                {openInvoices.map((i) => (
                  <option key={i.id} value={i.id}>{i.invoiceNumber} — outstanding {money(i.outstanding)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="al-amount" required>
              <Input id="al-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" disabled={loading || !invoiceId || (Number(amount) || 0) <= 0} onClick={submit}>
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

export function ReceiptsTab({
  companyId,
  receipts,
  customers,
  invoices,
  previewMode,
}: {
  companyId: string;
  receipts: CustomerReceipt[];
  customers: Customer[];
  invoices: SalesInvoice[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [allocatingId, setAllocatingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/sales/receipts`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? `Customer #${id}`;
  const invoiceNumber = (id: number) => invoices.find((i) => i.id === id)?.invoiceNumber ?? `#${id}`;

  const term = search.trim().toLowerCase();
  const filtered = term
    ? receipts.filter((r) => r.receiptNumber.toLowerCase().includes(term) || customerName(r.customerId).toLowerCase().includes(term))
    : receipts;

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
          <Input placeholder="Search receipt #, customer…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customer receipts" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || customers.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Receipt
        </Button>
      </div>

      {showForm && <ReceiptFormPanel companyId={companyId} customers={customers} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No customer receipts." description="No receipts match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Receipt #</TableHeadCell>
              <TableHeadCell>Customer</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell className="text-right">Amount</TableHeadCell>
              <TableHeadCell className="text-right">Unallocated</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((r) => {
              const isExpanded = expandedId === r.id;
              const allocated = round2(r.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
              const unallocated = round2(r.amount - allocated);
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${r.receiptNumber}` : `Expand ${r.receiptNumber}`} onClick={() => setExpandedId(isExpanded ? null : r.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{r.receiptNumber}</TableCell>
                    <TableCell>{customerName(r.customerId)}</TableCell>
                    <TableCell>{r.receiptDate}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(r.amount)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(unallocated)}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {r.status === "Draft" && (
                          <>
                            <Button variant="primary" size="sm" disabled={previewMode || loadingId === r.id} title={disabledTitle} onClick={() => runAction(r.id, "approve")}>
                              Approve &amp; Post
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === r.id} title={disabledTitle} onClick={() => runAction(r.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {r.status === "Approved" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === r.id} title={disabledTitle} onClick={() => runAction(r.id, "retry-post")}>
                            Retry Posting
                          </Button>
                        )}
                        {r.status === "Posted" && unallocated > 0 && (
                          <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setAllocatingId(allocatingId === r.id ? null : r.id)}>
                            Allocate
                          </Button>
                        )}
                        {r.status === "Posted" && (
                          <SendCommunicationButton
                            companyId={companyId}
                            module="Sales"
                            businessObjectType="CustomerReceipt"
                            businessObjectId={r.id}
                            templateCode="ReceiptEmail"
                            recipients={[{ type: "Customer", id: r.customerId, name: customerName(r.customerId), address: null }]}
                            variables={{ customerName: customerName(r.customerId), receiptNumber: r.receiptNumber, amount: money(r.amount) }}
                            previewMode={previewMode}
                            buttonLabel="Email Receipt"
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {allocatingId === r.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-vf-paper-alt/40">
                        <AllocationPanel companyId={companyId} receipt={r} invoices={invoices} onDone={() => { setAllocatingId(null); router.refresh(); }} onCancel={() => setAllocatingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-vf-paper-alt/40">
                        {r.allocations.length === 0 ? (
                          <p className="text-xs text-vf-ink-faint">No allocations yet.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody>
                              {r.allocations.map((a) => (
                                <tr key={a.id} className="border-b border-vf-paper-border/60">
                                  <td className="py-1 pr-2 font-mono text-vf-ink-soft">{invoiceNumber(a.invoiceId)}</td>
                                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(a.amountAllocated)}</td>
                                  <td className="py-1 text-right text-vf-ink-faint">{new Date(a.createdAt).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div className="mt-3">
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="CustomerReceipt" businessObjectId={r.id} previewMode={previewMode} />
                        </div>
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
