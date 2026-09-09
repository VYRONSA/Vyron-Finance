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
import type { InventoryTransaction, InventoryTransactionStatus, InventoryTransactionType, StockItem, Warehouse } from "@/server/inventory/types";

const MOVEMENT_TYPES: InventoryTransactionType[] = ["Receipt", "Issue", "Transfer", "Adjustment", "Return", "WriteOff", "OpeningBalance"];
const NEEDS_COST: InventoryTransactionType[] = ["Receipt", "Return", "OpeningBalance"];
const STATUS_TONE: Record<InventoryTransactionStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type EditableLine = { stockItemId: number; quantity: string; unitCost: string };

function MovementFormPanel({
  companyId,
  stockItems,
  warehouses,
  onDone,
  onCancel,
}: {
  companyId: string;
  stockItems: StockItem[];
  warehouses: Warehouse[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [transactionType, setTransactionType] = useState<InventoryTransactionType>("Receipt");
  const [direction, setDirection] = useState<"Increase" | "Decrease">("Increase");
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? 0);
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(warehouses[1]?.id ?? warehouses[0]?.id ?? 0);
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([{ stockItemId: stockItems[0]?.id ?? 0, quantity: "1", unitCost: "" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCost = NEEDS_COST.includes(transactionType) || (transactionType === "Adjustment" && direction === "Increase");
  const needsDestination = transactionType === "Transfer";

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/inventory/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionType,
          direction: transactionType === "Adjustment" ? direction : undefined,
          warehouseId,
          destinationWarehouseId: needsDestination ? destinationWarehouseId : undefined,
          transactionDate,
          reference,
          lines: lines.map((l) => ({ stockItemId: l.stockItemId, quantity: Number(l.quantity) || 0, unitCost: needsCost ? Number(l.unitCost) || 0 : undefined })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Inventory Movement</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Movement Type" htmlFor="mv-type" required>
          <Select id="mv-type" value={transactionType} onChange={(e) => setTransactionType(e.target.value as InventoryTransactionType)}>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        {transactionType === "Adjustment" && (
          <Field label="Direction" htmlFor="mv-direction" required>
            <Select id="mv-direction" value={direction} onChange={(e) => setDirection(e.target.value as "Increase" | "Decrease")}>
              <option value="Increase">Increase</option>
              <option value="Decrease">Decrease</option>
            </Select>
          </Field>
        )}
        <Field label={needsDestination ? "From Warehouse" : "Warehouse"} htmlFor="mv-warehouse" required>
          <Select id="mv-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>
        {needsDestination && (
          <Field label="To Warehouse" htmlFor="mv-dest" required>
            <Select id="mv-dest" value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(Number(e.target.value))}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Date" htmlFor="mv-date" required>
          <Input id="mv-date" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
        </Field>
        <Field label="Reference" htmlFor="mv-ref">
          <Input id="mv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px] flex-1">
              <Select aria-label={`Stock item for line ${i + 1}`} value={line.stockItemId} onChange={(e) => updateLine(i, { stockItemId: Number(e.target.value) })}>
                {stockItems.map((s) => (
                  <option key={s.id} value={s.id}>{s.stockCode} — {s.description}</option>
                ))}
              </Select>
            </div>
            <div className="w-28">
              <Input type="number" step="0.01" placeholder="Qty" aria-label={`Quantity for line ${i + 1}`} value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
            </div>
            {needsCost && (
              <div className="w-32">
                <Input type="number" step="0.01" placeholder="Unit Cost" aria-label={`Unit cost for line ${i + 1}`} value={line.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} />
              </div>
            )}
            <Button variant="subtle" size="sm" disabled={lines.length <= 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button variant="subtle" size="sm" className="w-fit" onClick={() => setLines((prev) => [...prev, { stockItemId: stockItems[0]?.id ?? 0, quantity: "1", unitCost: "" }])}>
          <IconPlus className="h-4 w-4" /> Add Line
        </Button>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !warehouseId || stockItems.length === 0} onClick={submit}>
          Create {transactionType}
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function TransactionsTab({
  companyId,
  transactions,
  stockItems,
  warehouses,
  previewMode,
}: {
  companyId: string;
  transactions: InventoryTransaction[];
  stockItems: StockItem[];
  warehouses: Warehouse[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<InventoryTransactionType | "All">("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/inventory/transactions`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const warehouseName = (id: number | null) => (id === null ? "—" : warehouses.find((w) => w.id === id)?.name ?? `#${id}`);
  const itemLabel = (id: number) => stockItems.find((s) => s.id === id)?.stockCode ?? `#${id}`;

  const term = search.trim().toLowerCase();
  const filtered = transactions.filter((t) => {
    if (typeFilter !== "All" && t.transactionType !== typeFilter) return false;
    if (!term) return true;
    return t.transactionNumber.toLowerCase().includes(term) || t.reference.toLowerCase().includes(term);
  });

  async function runAction(id: number, action: "submit" | "approve" | "retry-post" | "cancel") {
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
          <Select aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as InventoryTransactionType | "All")}>
            <option value="All">All Types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            <option value="StockTake">StockTake</option>
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search transaction #, reference…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search inventory transactions" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || stockItems.length === 0 || warehouses.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Movement
        </Button>
      </div>

      {showForm && (
        <MovementFormPanel companyId={companyId} stockItems={stockItems} warehouses={warehouses} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No inventory movements." description="No transactions match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Transaction #</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Warehouse</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((t) => {
              const isExpanded = expandedId === t.id;
              return (
                <Fragment key={t.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${t.transactionNumber}` : `Expand ${t.transactionNumber}`} onClick={() => setExpandedId(isExpanded ? null : t.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{t.transactionNumber}</TableCell>
                    <TableCell>{t.transactionType}{t.transactionType === "Adjustment" && t.direction ? ` (${t.direction})` : ""}</TableCell>
                    <TableCell>{warehouseName(t.warehouseId)}{t.destinationWarehouseId ? ` → ${warehouseName(t.destinationWarehouseId)}` : ""}</TableCell>
                    <TableCell>{t.transactionDate}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {t.status === "Draft" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === t.id} title={disabledTitle} onClick={() => runAction(t.id, "submit")}>
                              Submit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === t.id} title={disabledTitle} onClick={() => runAction(t.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {t.status === "Submitted" && (
                          <>
                            <Button variant="primary" size="sm" disabled={previewMode || loadingId === t.id} title={disabledTitle} onClick={() => runAction(t.id, "approve")}>
                              Approve &amp; Post
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === t.id} title={disabledTitle} onClick={() => runAction(t.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {t.status === "Approved" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === t.id} title={disabledTitle} onClick={() => runAction(t.id, "retry-post")}>
                            Retry Posting
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <table className="w-full text-xs">
                          <tbody>
                            {t.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 font-mono text-vf-ink-soft">{itemLabel(line.stockItemId)}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.quantity}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{money(line.unitCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {t.journalId !== null && <p className="mt-2 text-xs text-vf-ink-faint">Journal #{t.journalId}</p>}
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
