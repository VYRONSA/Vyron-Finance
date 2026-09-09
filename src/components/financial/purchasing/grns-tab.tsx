"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { Combobox } from "@/components/ui/combobox";
import { supplierOptions, stockItemOptions } from "@/lib/account-picker-options";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChevronDown, IconChevronLeft, IconFileText, IconPlus } from "@/components/ui/icons";
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";
import { CommunicationHistoryPanel } from "@/components/financial/communications/communication-history-panel";
import { DocumentsPanel } from "@/components/financial/documents/documents-panel";
import type { Supplier } from "@/server/accounting/types";
import type { GoodsReceivedNote, GoodsReceivedNoteStatus, PurchaseOrder } from "@/server/purchasing/types";
import type { StockItem } from "@/server/inventory/types";
import type { VatTreatment } from "@/server/company-management/types";

/** Finding #204 — a standalone GRN (no Purchase Order behind it) could
 * never become a Bill. Mirrors purchase-orders-tab.tsx's own
 * CreateBillPanel — GRN lines carry no per-line GL/VAT dimensions, so
 * this always goes through the legacy single-subtotal path. */
function GrnBillPanel({
  companyId,
  grn,
  vatTreatments,
  defaultVatCode,
  onDone,
  onCancel,
}: {
  companyId: string;
  grn: GoodsReceivedNote;
  vatTreatments: VatTreatment[];
  defaultVatCode: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [vatTreatmentCode, setVatTreatmentCode] = useState(defaultVatCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grnId: grn.id, invoiceNumber, invoiceDate, vatTreatmentCode }),
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
      <div className="w-48">
        <Field label="Supplier's Invoice Number" htmlFor={`grn-bill-inv-${grn.id}`} required>
          <Input id={`grn-bill-inv-${grn.id}`} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
      </div>
      <div className="w-40">
        <Field label="Invoice Date" htmlFor={`grn-bill-date-${grn.id}`} required>
          <Input id={`grn-bill-date-${grn.id}`} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
      </div>
      <div className="w-44">
        <Field label="VAT Treatment" htmlFor={`grn-bill-vat-${grn.id}`}>
          <Select id={`grn-bill-vat-${grn.id}`} value={vatTreatmentCode} onChange={(e) => setVatTreatmentCode(e.target.value)}>
            {vatTreatments.map((v) => (
              <option key={v.code} value={v.code}>{v.name} ({v.rate}%)</option>
            ))}
          </Select>
        </Field>
      </div>
      <Button variant="primary" size="sm" disabled={loading || !invoiceNumber.trim()} onClick={submit}>
        Create Bill
      </Button>
      <Button variant="subtle" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

const STATUS_TONE: Record<GoodsReceivedNoteStatus, "muted" | "good" | "danger"> = { Draft: "muted", Received: "good", Cancelled: "danger" };
const STATUS_OPTIONS: (GoodsReceivedNoteStatus | "All")[] = ["All", "Draft", "Received", "Cancelled"];

type EditableLine = { orderLineId: number | null; description: string; quantity: string; max: number | null; stockItemId: number | null; unitCost: string };

function GrnFormPanel({
  companyId,
  suppliers,
  orders,
  stockItems,
  onDone,
  onCancel,
}: {
  companyId: string;
  suppliers: Supplier[];
  orders: PurchaseOrder[];
  stockItems: StockItem[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const receivableOrders = orders.filter((o) => o.status === "Approved" || o.status === "PartiallyReceived");
  const [orderId, setOrderId] = useState<number | "">("");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? 0);
  const activeSupplierOptions = supplierOptions(suppliers.filter((s) => s.status === "Active"));
  const activeStockItemOptions = stockItemOptions(stockItems);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<EditableLine[]>([{ orderLineId: null, description: "", quantity: "1", max: null, stockItemId: null, unitCost: "0" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectOrder(value: string) {
    if (!value) {
      setOrderId("");
      setLines([{ orderLineId: null, description: "", quantity: "1", max: null, stockItemId: null, unitCost: "0" }]);
      return;
    }
    const id = Number(value);
    const order = receivableOrders.find((o) => o.id === id);
    if (!order) return;
    setOrderId(id);
    setSupplierId(order.supplierId);
    setLines(
      order.lines
        .filter((l) => l.quantity - l.receivedQuantity > 0)
        .map((l) => ({
          orderLineId: l.id,
          description: l.description,
          quantity: String(l.quantity - l.receivedQuantity),
          max: l.quantity - l.receivedQuantity,
          stockItemId: l.stockItemId,
          unitCost: String(l.unitPrice ?? 0),
        })),
    );
  }

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/grns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          orderId: orderId || null,
          receivedDate,
          lines: lines.map((l) => ({ orderLineId: l.orderLineId, description: l.description, quantity: Number(l.quantity) || 0, stockItemId: l.stockItemId, unitCost: Number(l.unitCost) || 0 })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Goods Received Note</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="From Purchase Order" htmlFor="grn-order">
          <Select id="grn-order" value={orderId} onChange={(e) => selectOrder(e.target.value)}>
            <option value="">Standalone (no order)</option>
            {receivableOrders.map((o) => (
              <option key={o.id} value={o.id}>{o.orderNumber}</option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier" htmlFor="grn-supplier" required>
          {/* Finding #200 — see bills-tab.tsx's identical note. Finding
              #167 — searchable Combobox instead of a plain Select. */}
          <Combobox aria-label="Supplier" value={supplierId || null} disabled={orderId !== ""} options={activeSupplierOptions} placeholder="Search supplier…" onCommit={(val) => setSupplierId(val ?? 0)} />
        </Field>
        <Field label="Received Date" htmlFor="grn-date" required>
          <Input id="grn-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input placeholder="Description" aria-label={`Description for line ${i + 1}`} value={line.description} disabled={line.orderLineId !== null} onChange={(e) => updateLine(i, { description: e.target.value })} />
            </div>
            <div className="w-56">
              {/* Finding #008 — a Stock Item picked here drives the real
                  automatic Inventory Receipt this GRN already triggers on
                  submit (goods-received-note-service.ts reads
                  line.stockItemId per line) — previously unreachable from
                  the UI. Optional — a service/non-stock line leaves this
                  unset, exactly as before. */}
              <Combobox
                aria-label={`Stock item for line ${i + 1}`}
                value={line.stockItemId}
                disabled={line.orderLineId !== null}
                options={activeStockItemOptions}
                placeholder="Stock item (optional)"
                onCommit={(val) => updateLine(i, { stockItemId: val, unitCost: val && !Number(line.unitCost) ? String(stockItems.find((s) => s.id === val)?.costPrice ?? 0) : line.unitCost })}
              />
            </div>
            <div className="w-24">
              <Input
                type="number"
                step="0.01"
                placeholder="Qty"
                aria-label={`Quantity for line ${i + 1}`}
                value={line.quantity}
                onChange={(e) => updateLine(i, { quantity: line.max !== null ? String(Math.min(Number(e.target.value) || 0, line.max)) : e.target.value })}
              />
            </div>
            {line.stockItemId !== null && (
              <div className="w-28">
                <Input type="number" step="0.01" placeholder="Unit Cost" aria-label={`Unit cost for line ${i + 1}`} value={line.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} />
              </div>
            )}
            {line.max !== null && <span className="text-xs text-vf-ink-faint">of {line.max} remaining</span>}
            {orderId === "" && (
              <Button variant="subtle" size="sm" disabled={lines.length <= 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            )}
          </div>
        ))}
        {orderId === "" && (
          <Button variant="subtle" size="sm" className="w-fit" onClick={() => setLines((prev) => [...prev, { orderLineId: null, description: "", quantity: "1", max: null, stockItemId: null, unitCost: "0" }])}>
            <IconPlus className="h-4 w-4" /> Add Line
          </Button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !supplierId || lines.length === 0} onClick={submit}>
          Create GRN
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function GrnsTab({
  companyId,
  grns,
  suppliers,
  orders,
  stockItems,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  grns: GoodsReceivedNote[];
  suppliers: Supplier[];
  orders: PurchaseOrder[];
  stockItems: StockItem[];
  vatTreatments: VatTreatment[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const defaultVatCode = vatTreatments[0]?.code ?? "Standard Rated";
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [billingId, setBillingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelConfirm = useConfirmTarget<number>();

  const base = `/api/companies/${companyId}/purchasing/grns`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const supplierName = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;
  const orderNumber = (id: number | null) => (id === null ? "—" : (orders.find((o) => o.id === id)?.orderNumber ?? `#${id}`));

  const term = search.trim().toLowerCase();
  const filtered = grns.filter((g) => {
    if (statusFilter !== "All" && g.status !== statusFilter) return false;
    if (!term) return true;
    return g.grnNumber.toLowerCase().includes(term) || supplierName(g.supplierId).toLowerCase().includes(term);
  });

  async function cancelGrn(id: number) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      cancelConfirm.cancel();
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
        <div className="w-36">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search GRN #, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search goods received notes" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || suppliers.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New GRN
        </Button>
      </div>

      {showForm && <GrnFormPanel companyId={companyId} suppliers={suppliers} orders={orders} stockItems={stockItems} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No goods received notes." description="No GRNs match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>GRN #</TableHeadCell>
              <TableHeadCell>Supplier</TableHeadCell>
              <TableHeadCell>Order</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((g) => {
              const isExpanded = expandedId === g.id;
              return (
                <Fragment key={g.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${g.grnNumber}` : `Expand ${g.grnNumber}`} onClick={() => setExpandedId(isExpanded ? null : g.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{g.grnNumber}</TableCell>
                    <TableCell>{supplierName(g.supplierId)}</TableCell>
                    <TableCell className="font-mono text-xs">{orderNumber(g.orderId)}</TableCell>
                    <TableCell>{g.receivedDate}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[g.status]}>{g.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {g.status === "Received" && (
                          cancelConfirm.isConfirming(g.id) ? (
                            <ConfirmActionRow message="Cancel this GRN?" confirmLabel="Confirm" confirmingLabel="Cancelling…" loading={loadingId === g.id} tone="danger" size="sm" onConfirm={() => cancelGrn(g.id)} onCancel={cancelConfirm.cancel} />
                          ) : (
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === g.id} title={disabledTitle} onClick={() => cancelConfirm.request(g.id)}>
                              Cancel
                            </Button>
                          )
                        )}
                        {/* Finding #204 — a standalone GRN (no linked
                            Purchase Order) can now be billed directly. */}
                        {g.status === "Received" && g.orderId === null && (
                          <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setBillingId(billingId === g.id ? null : g.id)}>
                            Create Bill
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {billingId === g.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <GrnBillPanel companyId={companyId} grn={g} vatTreatments={vatTreatments} defaultVatCode={defaultVatCode} onDone={() => { setBillingId(null); router.refresh(); }} onCancel={() => setBillingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <table className="w-full text-xs">
                          <tbody>
                            {g.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{line.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-3 flex flex-col gap-3">
                          <SendCommunicationButton
                            companyId={companyId}
                            module="Purchasing"
                            businessObjectType="GoodsReceivedNote"
                            businessObjectId={g.id}
                            templateCode="GoodsReceiptConfirmation"
                            recipients={[{ type: "Supplier", id: g.supplierId, name: supplierName(g.supplierId), address: null }]}
                            variables={{ supplierName: supplierName(g.supplierId), grnNumber: g.grnNumber }}
                            previewMode={previewMode}
                            buttonLabel="Email Confirmation"
                          />
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="GoodsReceivedNote" businessObjectId={g.id} previewMode={previewMode} />
                          <DocumentsPanel companyId={companyId} entityType="GoodsReceivedNote" entityId={g.id} previewMode={previewMode} />
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
