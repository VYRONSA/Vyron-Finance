"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { Combobox } from "@/components/ui/combobox";
import { customerOptions, glAccountOptions, stockItemOptions, vatCodeOptions } from "@/lib/account-picker-options";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChevronDown, IconChevronLeft, IconFileText, IconPlus } from "@/components/ui/icons";
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";
import { CommunicationHistoryPanel } from "@/components/financial/communications/communication-history-panel";
import { DocumentsPanel } from "@/components/financial/documents/documents-panel";
import type { Customer } from "@/server/customer-management/types";
import type { SalesOrder, SalesOrderStatus } from "@/server/sales/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { StockItem } from "@/server/inventory/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import { formatAmount } from "@/lib/format";

const STATUS_OPTIONS: (SalesOrderStatus | "All")[] = ["All", "Draft", "Confirmed", "PartiallyDelivered", "Delivered", "Invoiced", "Cancelled"];
const STATUS_TONE: Record<SalesOrderStatus, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted",
  Confirmed: "info",
  PartiallyDelivered: "warn",
  Delivered: "good",
  Invoiced: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return formatAmount(value);
}

type EditableLine = { description: string; quantity: string; unitPrice: string; stockItemId: number | null; glAccount: string | null; vatCode: string | null; discount: string };
const BLANK_LINE: EditableLine = { description: "", quantity: "1", unitPrice: "", stockItemId: null, glAccount: null, vatCode: null, discount: "0" };

function OrderFormPanel({ companyId, customers, stockItems, chartOfAccounts, vatTreatments, onDone, onCancel }: { companyId: string; customers: Customer[]; stockItems: StockItem[]; chartOfAccounts: ChartOfAccount[]; vatTreatments: VatTreatment[]; onDone: () => void; onCancel: () => void }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? 0);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<EditableLine[]>([{ ...BLANK_LINE }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.round(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0) * 100) / 100;
  const activeCustomerOptions = customerOptions(customers.filter((c) => c.isActive));
  const activeStockItemOptions = stockItemOptions(stockItems);
  const glOptions = glAccountOptions(chartOfAccounts);
  const vatOptions = vatCodeOptions(vatTreatments);

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          orderDate,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 0,
            unitPrice: Number(l.unitPrice) || 0,
            stockItemId: l.stockItemId,
            glAccount: l.glAccount,
            vatCode: l.vatCode,
            discount: Number(l.discount) || 0,
          })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Sales Order</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Customer" htmlFor="so-customer" required>
          {/* Finding #200 — options list is pre-filtered to Active-only,
              see deliveries-tab.tsx's identical note. Finding #167 —
              searchable Combobox instead of a plain unfiltered Select. */}
          <Combobox aria-label="Customer" value={customerId || null} options={activeCustomerOptions} placeholder="Search customer…" onCommit={(val) => setCustomerId(val ?? 0)} />
        </Field>
        <Field label="Order Date" htmlFor="so-date" required>
          <Input id="so-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input placeholder="Description" aria-label={`Description for line ${i + 1}`} value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
            </div>
            <div className="w-56">
              {/* Finding #008 — a Stock Item picked here flows through to
                  the Invoice's automatic inventory Issue when this order
                  is later invoiced (createInvoiceFromOrder already copies
                  stockItemId per line). Optional — a service/non-stock
                  line just leaves this unset, exactly as before. */}
              <Combobox aria-label={`Stock item for line ${i + 1}`} value={line.stockItemId} options={activeStockItemOptions} placeholder="Stock item (optional)" onCommit={(val) => updateLine(i, { stockItemId: val })} />
            </div>
            <div className="w-24">
              <Input type="number" step="0.01" placeholder="Qty" aria-label={`Quantity for line ${i + 1}`} value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
            </div>
            <div className="w-32">
              <Input type="number" step="0.01" placeholder="Unit Price" aria-label={`Unit price for line ${i + 1}`} value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
            </div>
            {/* Finding #113 — GL/VAT/discount capture on Sales Order
                lines, mirroring Purchase Order lines exactly. All
                optional, "where applicable" per the shared line-dimension
                convention — cost centre/project/department are skipped
                here (Sales Orders don't post to the GL, budgetary only,
                same as Purchase Orders). */}
            <div className="w-44">
              <Combobox aria-label={`GL account for line ${i + 1}`} value={line.glAccount} options={glOptions} placeholder="GL account (optional)" onCommit={(val) => updateLine(i, { glAccount: val })} />
            </div>
            <div className="w-40">
              <Combobox aria-label={`VAT code for line ${i + 1}`} value={line.vatCode} options={vatOptions} placeholder="VAT (optional)" onCommit={(val) => updateLine(i, { vatCode: val })} />
            </div>
            <div className="w-28">
              <Input type="number" step="0.01" placeholder="Discount" aria-label={`Discount for line ${i + 1}`} value={line.discount} onChange={(e) => updateLine(i, { discount: e.target.value })} />
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

      <p className="mt-3 font-mono text-sm font-semibold tabular-nums text-vf-ink">Total: {money(total)}</p>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !customerId || total <= 0} onClick={submit}>
          Create Order
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

/** Finding #164 — mirrors `purchase-orders-tab.tsx`'s own
 * `EditOrderLinesPanel`: only ever rendered for a Draft order (see the
 * gating at its call site), reusing `order.lines` already embedded in
 * the list response rather than a separate fetch. */
function EditOrderLinesPanel({ companyId, order, stockItems, chartOfAccounts, vatTreatments, onDone, onCancel }: { companyId: string; order: SalesOrder; stockItems: StockItem[]; chartOfAccounts: ChartOfAccount[]; vatTreatments: VatTreatment[]; onDone: () => void; onCancel: () => void }) {
  const [lines, setLines] = useState<EditableLine[]>(() =>
    order.lines.length > 0
      ? order.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), stockItemId: l.stockItemId, glAccount: l.glAccount, vatCode: l.vatCode, discount: String(l.discount) }))
      : [{ ...BLANK_LINE }],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStockItemOptions = stockItemOptions(stockItems);
  const glOptions = glAccountOptions(chartOfAccounts);
  const vatOptions = vatCodeOptions(vatTreatments);

  const total = Math.round(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0) * 100) / 100;

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-lines",
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 0,
            unitPrice: Number(l.unitPrice) || 0,
            stockItemId: l.stockItemId,
            glAccount: l.glAccount,
            vatCode: l.vatCode,
            discount: Number(l.discount) || 0,
          })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">Editing {order.orderNumber}</p>
      <div className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input placeholder="Description" aria-label={`Description for line ${i + 1}`} value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
            </div>
            <div className="w-56">
              <Combobox aria-label={`Stock item for line ${i + 1}`} value={line.stockItemId} options={activeStockItemOptions} placeholder="Stock item (optional)" onCommit={(val) => updateLine(i, { stockItemId: val })} />
            </div>
            <div className="w-24">
              <Input type="number" step="0.01" placeholder="Qty" aria-label={`Quantity for line ${i + 1}`} value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
            </div>
            <div className="w-32">
              <Input type="number" step="0.01" placeholder="Unit Price" aria-label={`Unit price for line ${i + 1}`} value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
            </div>
            <div className="w-44">
              <Combobox aria-label={`GL account for line ${i + 1}`} value={line.glAccount} options={glOptions} placeholder="GL account (optional)" onCommit={(val) => updateLine(i, { glAccount: val })} />
            </div>
            <div className="w-40">
              <Combobox aria-label={`VAT code for line ${i + 1}`} value={line.vatCode} options={vatOptions} placeholder="VAT (optional)" onCommit={(val) => updateLine(i, { vatCode: val })} />
            </div>
            <div className="w-28">
              <Input type="number" step="0.01" placeholder="Discount" aria-label={`Discount for line ${i + 1}`} value={line.discount} onChange={(e) => updateLine(i, { discount: e.target.value })} />
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
      <p className="mt-3 font-mono text-sm font-semibold tabular-nums text-vf-ink">Total: {money(total)}</p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || total <= 0} onClick={save}>
          Save Changes
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

/** Finding #208 — Order -> Invoice previously silently sent whichever
 * VAT treatment happened to be first in the list, with no control. */
function CreateInvoicePanel({
  companyId,
  order,
  vatTreatments,
  defaultVatCode,
  onDone,
  onCancel,
}: {
  companyId: string;
  order: SalesOrder;
  vatTreatments: VatTreatment[];
  defaultVatCode: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [vatTreatmentCode, setVatTreatmentCode] = useState(defaultVatCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, invoiceDate: new Date().toISOString().slice(0, 10), vatTreatmentCode }),
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
      <div className="w-44">
        <Field label="VAT Treatment" htmlFor={`so-inv-vat-${order.id}`}>
          <Select id={`so-inv-vat-${order.id}`} value={vatTreatmentCode} onChange={(e) => setVatTreatmentCode(e.target.value)}>
            {vatTreatments.map((v) => (
              <option key={v.code} value={v.code}>{v.name} ({v.rate}%)</option>
            ))}
          </Select>
        </Field>
      </div>
      <Button variant="primary" size="sm" disabled={loading} onClick={submit}>
        Create Invoice
      </Button>
      <Button variant="subtle" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function SalesOrdersTab({
  companyId,
  orders,
  customers,
  vatTreatments,
  stockItems,
  chartOfAccounts,
  previewMode,
}: {
  companyId: string;
  orders: SalesOrder[];
  customers: Customer[];
  vatTreatments: VatTreatment[];
  stockItems: StockItem[];
  chartOfAccounts: ChartOfAccount[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [invoicingId, setInvoicingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelConfirm = useConfirmTarget<number>();

  const base = `/api/companies/${companyId}/sales/orders`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? `Customer #${id}`;
  const defaultVatCode = vatTreatments[0]?.code ?? "Standard Rated";

  const term = search.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (statusFilter !== "All" && o.status !== statusFilter) return false;
    if (!term) return true;
    return o.orderNumber.toLowerCase().includes(term) || customerName(o.customerId).toLowerCase().includes(term);
  });

  async function runAction(id: number, action: "confirm" | "cancel") {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (action === "cancel") cancelConfirm.cancel();
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
        <div className="w-44">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search order #, customer…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sales orders" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || customers.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Order
        </Button>
      </div>

      {showForm && <OrderFormPanel companyId={companyId} customers={customers} stockItems={stockItems} chartOfAccounts={chartOfAccounts} vatTreatments={vatTreatments} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No sales orders." description="No sales orders match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Order #</TableHeadCell>
              <TableHeadCell>Customer</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell className="text-right">Total</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((o) => {
              const isExpanded = expandedId === o.id;
              const total = o.lines.reduce((sum, l) => sum + l.lineTotal, 0);
              return (
                <Fragment key={o.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${o.orderNumber}` : `Expand ${o.orderNumber}`} onClick={() => setExpandedId(isExpanded ? null : o.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">
                      {o.orderNumber}
                      {o.quotationId !== null && <span className="ml-1.5 text-[10px] text-vf-ink-faint">from QT</span>}
                    </TableCell>
                    <TableCell>{customerName(o.customerId)}</TableCell>
                    <TableCell>{o.orderDate}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(total)}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {o.status === "Draft" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => setEditingId(editingId === o.id ? null : o.id)}>
                              Edit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => runAction(o.id, "confirm")}>
                              Confirm
                            </Button>
                            {cancelConfirm.isConfirming(o.id) ? (
                              <ConfirmActionRow message="Cancel this order?" confirmLabel="Confirm" confirmingLabel="Cancelling…" loading={loadingId === o.id} tone="danger" size="sm" onConfirm={() => runAction(o.id, "cancel")} onCancel={cancelConfirm.cancel} />
                            ) : (
                              <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => cancelConfirm.request(o.id)}>
                                Cancel
                              </Button>
                            )}
                          </>
                        )}
                        {(o.status === "Confirmed" || o.status === "PartiallyDelivered") && (
                          cancelConfirm.isConfirming(o.id) ? (
                            <ConfirmActionRow message="Cancel this order?" confirmLabel="Confirm" confirmingLabel="Cancelling…" loading={loadingId === o.id} tone="danger" size="sm" onConfirm={() => runAction(o.id, "cancel")} onCancel={cancelConfirm.cancel} />
                          ) : (
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => cancelConfirm.request(o.id)}>
                              Cancel
                            </Button>
                          )
                        )}
                        {/* Finding #053 — a PartiallyDelivered order can
                            now be invoiced for whatever's been delivered
                            but not yet invoiced, not just once fully
                            Delivered. */}
                        {(o.status === "Delivered" || o.status === "PartiallyDelivered") && o.lines.some((l) => l.deliveredQuantity > l.invoicedQuantity) && (
                          <Button variant="primary" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => setInvoicingId(invoicingId === o.id ? null : o.id)}>
                            Create Invoice
                          </Button>
                        )}
                        {(o.status === "Confirmed" || o.status === "PartiallyDelivered" || o.status === "Delivered" || o.status === "Invoiced") && (
                          <SendCommunicationButton
                            companyId={companyId}
                            module="Sales"
                            businessObjectType="SalesOrder"
                            businessObjectId={o.id}
                            templateCode="SalesOrderConfirmation"
                            recipients={[{ type: "Customer", id: o.customerId, name: customerName(o.customerId), address: null }]}
                            variables={{ customerName: customerName(o.customerId), orderNumber: o.orderNumber, total: money(total) }}
                            previewMode={previewMode}
                            buttonLabel="Email Confirmation"
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {invoicingId === o.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <CreateInvoicePanel companyId={companyId} order={o} vatTreatments={vatTreatments} defaultVatCode={defaultVatCode} onDone={() => { setInvoicingId(null); router.refresh(); }} onCancel={() => setInvoicingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {editingId === o.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <EditOrderLinesPanel companyId={companyId} order={o} stockItems={stockItems} chartOfAccounts={chartOfAccounts} vatTreatments={vatTreatments} onDone={() => { setEditingId(null); router.refresh(); }} onCancel={() => setEditingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-vf-ink-faint">
                              <th className="py-1 pr-2 font-medium">Description</th>
                              <th className="py-1 pr-2 text-right font-medium">Qty</th>
                              <th className="py-1 pr-2 text-right font-medium">Delivered</th>
                              <th className="py-1 pr-2 text-right font-medium">Invoiced</th>
                              <th className="py-1 text-right font-medium">Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.quantity}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.deliveredQuantity}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.invoicedQuantity}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{money(line.lineTotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-3 flex flex-col gap-3">
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="SalesOrder" businessObjectId={o.id} previewMode={previewMode} />
                          <DocumentsPanel companyId={companyId} entityType="SalesOrder" entityId={o.id} previewMode={previewMode} />
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
