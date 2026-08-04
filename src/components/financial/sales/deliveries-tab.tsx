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
import type { Delivery, DeliveryStatus, SalesOrder } from "@/server/sales/types";

const STATUS_TONE: Record<DeliveryStatus, "muted" | "good" | "danger"> = { Draft: "muted", Delivered: "good", Cancelled: "danger" };

type EditableLine = { orderLineId: number | null; description: string; quantity: string; max: number | null };

function DeliveryFormPanel({
  companyId,
  customers,
  orders,
  onDone,
  onCancel,
}: {
  companyId: string;
  customers: Customer[];
  orders: SalesOrder[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const deliverableOrders = orders.filter((o) => o.status === "Confirmed" || o.status === "PartiallyDelivered");
  const [orderId, setOrderId] = useState<number | "">("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? 0);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<EditableLine[]>([{ orderLineId: null, description: "", quantity: "1", max: null }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectOrder(value: string) {
    if (!value) {
      setOrderId("");
      setLines([{ orderLineId: null, description: "", quantity: "1", max: null }]);
      return;
    }
    const id = Number(value);
    const order = deliverableOrders.find((o) => o.id === id);
    if (!order) return;
    setOrderId(id);
    setCustomerId(order.customerId);
    setLines(
      order.lines
        .filter((l) => l.quantity - l.deliveredQuantity > 0)
        .map((l) => ({ orderLineId: l.id, description: l.description, quantity: String(l.quantity - l.deliveredQuantity), max: l.quantity - l.deliveredQuantity })),
    );
  }

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/deliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          orderId: orderId || null,
          deliveryDate,
          lines: lines.map((l) => ({ orderLineId: l.orderLineId, description: l.description, quantity: Number(l.quantity) || 0 })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Delivery</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="From Sales Order" htmlFor="dl-order">
          <Select id="dl-order" value={orderId} onChange={(e) => selectOrder(e.target.value)}>
            <option value="">Standalone (no order)</option>
            {deliverableOrders.map((o) => (
              <option key={o.id} value={o.id}>{o.orderNumber}</option>
            ))}
          </Select>
        </Field>
        <Field label="Customer" htmlFor="dl-customer" required>
          <Select id="dl-customer" value={customerId} disabled={orderId !== ""} onChange={(e) => setCustomerId(Number(e.target.value))}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.customerCode} — {c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Delivery Date" htmlFor="dl-date" required>
          <Input id="dl-date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input placeholder="Description" aria-label={`Description for line ${i + 1}`} value={line.description} disabled={line.orderLineId !== null} onChange={(e) => updateLine(i, { description: e.target.value })} />
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
            {line.max !== null && <span className="text-xs text-vf-ink-faint">of {line.max} remaining</span>}
            {orderId === "" && (
              <Button variant="subtle" size="sm" disabled={lines.length <= 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            )}
          </div>
        ))}
        {orderId === "" && (
          <Button variant="subtle" size="sm" className="w-fit" onClick={() => setLines((prev) => [...prev, { orderLineId: null, description: "", quantity: "1", max: null }])}>
            <IconPlus className="h-4 w-4" /> Add Line
          </Button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !customerId || lines.length === 0} onClick={submit}>
          Create Delivery
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function DeliveriesTab({
  companyId,
  deliveries,
  customers,
  orders,
  previewMode,
}: {
  companyId: string;
  deliveries: Delivery[];
  customers: Customer[];
  orders: SalesOrder[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/sales/deliveries`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? `Customer #${id}`;
  const orderNumber = (id: number | null) => (id === null ? "—" : (orders.find((o) => o.id === id)?.orderNumber ?? `#${id}`));

  const term = search.trim().toLowerCase();
  const filtered = term
    ? deliveries.filter((d) => d.deliveryNumber.toLowerCase().includes(term) || customerName(d.customerId).toLowerCase().includes(term))
    : deliveries;

  async function cancelDelivery(id: number) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
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
          <Input placeholder="Search delivery #, customer…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search deliveries" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || customers.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Delivery
        </Button>
      </div>

      {showForm && <DeliveryFormPanel companyId={companyId} customers={customers} orders={orders} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No deliveries." description="No deliveries match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Delivery #</TableHeadCell>
              <TableHeadCell>Customer</TableHeadCell>
              <TableHeadCell>Order</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((d) => {
              const isExpanded = expandedId === d.id;
              return (
                <Fragment key={d.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${d.deliveryNumber}` : `Expand ${d.deliveryNumber}`} onClick={() => setExpandedId(isExpanded ? null : d.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{d.deliveryNumber}</TableCell>
                    <TableCell>{customerName(d.customerId)}</TableCell>
                    <TableCell className="font-mono text-xs">{orderNumber(d.orderId)}</TableCell>
                    <TableCell>{d.deliveryDate}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {d.status === "Delivered" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === d.id} title={disabledTitle} onClick={() => cancelDelivery(d.id)}>
                              Cancel
                            </Button>
                            <SendCommunicationButton
                              companyId={companyId}
                              module="Sales"
                              businessObjectType="Delivery"
                              businessObjectId={d.id}
                              templateCode="DeliveryConfirmation"
                              recipients={[{ type: "Customer", id: d.customerId, name: customerName(d.customerId), address: null }]}
                              variables={{ customerName: customerName(d.customerId), orderNumber: orderNumber(d.orderId) }}
                              previewMode={previewMode}
                              buttonLabel="Email Confirmation"
                            />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <table className="w-full text-xs">
                          <tbody>
                            {d.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{line.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-3">
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="Delivery" businessObjectId={d.id} previewMode={previewMode} />
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
