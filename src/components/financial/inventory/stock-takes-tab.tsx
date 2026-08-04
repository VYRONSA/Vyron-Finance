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
import type { StockItem, StockTake, StockTakeStatus, Warehouse } from "@/server/inventory/types";

const STATUS_TONE: Record<StockTakeStatus, "muted" | "good" | "danger"> = { Draft: "muted", Finalized: "good", Cancelled: "danger" };

type EditableLine = { stockItemId: number; countedQuantity: string };

function StockTakeFormPanel({
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
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? 0);
  const [countDate, setCountDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<EditableLine[]>([{ stockItemId: stockItems[0]?.id ?? 0, countedQuantity: "0" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/inventory/stock-takes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          countDate,
          lines: lines.map((l) => ({ stockItemId: l.stockItemId, countedQuantity: Number(l.countedQuantity) || 0 })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Stock Take</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Warehouse" htmlFor="stk-wh" required>
          <Select id="stk-wh" value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Count Date" htmlFor="stk-date" required>
          <Input id="stk-date" type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Counted Quantities</p>
        {lines.map((line, i) => {
          const item = stockItems.find((s) => s.id === line.stockItemId);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <div className="min-w-[220px] flex-1">
                <Select aria-label={`Stock item for line ${i + 1}`} value={line.stockItemId} onChange={(e) => updateLine(i, { stockItemId: Number(e.target.value) })}>
                  {stockItems.map((s) => (
                    <option key={s.id} value={s.id}>{s.stockCode} — {s.description}</option>
                  ))}
                </Select>
              </div>
              <span className="text-xs text-vf-ink-faint">System: {item?.quantityOnHand ?? "—"}</span>
              <div className="w-28">
                <Input type="number" step="0.01" placeholder="Counted" aria-label={`Counted quantity for line ${i + 1}`} value={line.countedQuantity} onChange={(e) => updateLine(i, { countedQuantity: e.target.value })} />
              </div>
              <Button variant="subtle" size="sm" disabled={lines.length <= 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            </div>
          );
        })}
        <Button variant="subtle" size="sm" className="w-fit" onClick={() => setLines((prev) => [...prev, { stockItemId: stockItems[0]?.id ?? 0, countedQuantity: "0" }])}>
          <IconPlus className="h-4 w-4" /> Add Line
        </Button>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !warehouseId || stockItems.length === 0} onClick={submit}>
          Create Stock Take
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function StockTakesTab({
  companyId,
  stockTakes,
  stockItems,
  warehouses,
  previewMode,
}: {
  companyId: string;
  stockTakes: StockTake[];
  stockItems: StockItem[];
  warehouses: Warehouse[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; adjustmentsCreated: number } | null>(null);

  const base = `/api/companies/${companyId}/inventory/stock-takes`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const warehouseName = (id: number) => warehouses.find((w) => w.id === id)?.name ?? `#${id}`;
  const itemLabel = (id: number) => stockItems.find((s) => s.id === id)?.stockCode ?? `#${id}`;

  async function finalize(id: number) {
    setLoadingId(id);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize" }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult({ id, adjustmentsCreated: data.adjustmentsCreated ?? 0 });
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="primary" size="sm" disabled={previewMode || stockItems.length === 0 || warehouses.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Stock Take
        </Button>
      </div>

      {showForm && (
        <StockTakeFormPanel companyId={companyId} stockItems={stockItems} warehouses={warehouses} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}
      {result && (
        <p className="text-sm text-vf-ink">
          Finalized — {result.adjustmentsCreated} variance adjustment{result.adjustmentsCreated === 1 ? "" : "s"} posted automatically.
        </p>
      )}

      {stockTakes.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No stock takes." description="No stock takes recorded yet." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Stock Take #</TableHeadCell>
              <TableHeadCell>Warehouse</TableHeadCell>
              <TableHeadCell>Count Date</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {stockTakes.map((s) => {
              const isExpanded = expandedId === s.id;
              return (
                <Fragment key={s.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${s.stockTakeNumber}` : `Expand ${s.stockTakeNumber}`} onClick={() => setExpandedId(isExpanded ? null : s.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{s.stockTakeNumber}</TableCell>
                    <TableCell>{warehouseName(s.warehouseId)}</TableCell>
                    <TableCell>{s.countDate}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {s.status === "Draft" && (
                        <Button variant="primary" size="sm" disabled={previewMode || loadingId === s.id} title={disabledTitle} onClick={() => finalize(s.id)}>
                          Finalize
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-vf-paper-alt/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-vf-ink-faint">
                              <th className="py-1 pr-2 font-medium">Item</th>
                              <th className="py-1 pr-2 text-right font-medium">System Qty</th>
                              <th className="py-1 pr-2 text-right font-medium">Counted Qty</th>
                              <th className="py-1 text-right font-medium">Variance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 font-mono text-vf-ink-soft">{itemLabel(line.stockItemId)}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.systemQuantity}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.countedQuantity}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{line.countedQuantity - line.systemQuantity}</td>
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
