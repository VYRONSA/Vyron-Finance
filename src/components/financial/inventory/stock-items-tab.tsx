"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArchive, IconPlus } from "@/components/ui/icons";
import type { StockItem, StockItemStatus, Warehouse } from "@/server/inventory/types";
import type { VatTreatment } from "@/server/company-management/types";

const STATUS_OPTIONS: (StockItemStatus | "All")[] = ["All", "Active", "Inactive", "Discontinued"];
const STATUS_TONE: Record<StockItemStatus, "good" | "muted" | "danger"> = { Active: "good", Inactive: "muted", Discontinued: "danger" };

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StockItemFormPanel({
  companyId,
  warehouses,
  vatTreatments,
  onDone,
  onCancel,
}: {
  companyId: string;
  warehouses: Warehouse[];
  vatTreatments: VatTreatment[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [stockCode, setStockCode] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("Each");
  const [defaultWarehouseId, setDefaultWarehouseId] = useState(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? 0);
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [safetyStock, setSafetyStock] = useState("");
  const [vatTreatmentCode, setVatTreatmentCode] = useState(vatTreatments[0]?.code ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/inventory/stock-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockCode,
          description,
          category,
          unitOfMeasure,
          defaultWarehouseId: defaultWarehouseId || null,
          sellingPrice: Number(sellingPrice) || 0,
          costPrice: Number(costPrice) || 0,
          reorderLevel: Number(reorderLevel) || 0,
          safetyStock: Number(safetyStock) || 0,
          vatTreatmentCode,
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Stock Item</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Stock Code" htmlFor="si-code" required>
          <Input id="si-code" value={stockCode} onChange={(e) => setStockCode(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="si-desc" required className="lg:col-span-2">
          <Input id="si-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="si-cat">
          <Input id="si-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="Unit of Measure" htmlFor="si-uom">
          <Input id="si-uom" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} />
        </Field>
        <Field label="Default Warehouse" htmlFor="si-wh">
          <Select id="si-wh" value={defaultWarehouseId} onChange={(e) => setDefaultWarehouseId(Number(e.target.value))}>
            <option value={0}>None</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="VAT Treatment" htmlFor="si-vat">
          <Select id="si-vat" value={vatTreatmentCode} onChange={(e) => setVatTreatmentCode(e.target.value)}>
            {vatTreatments.map((v) => (
              <option key={v.code} value={v.code}>{v.name} ({v.rate}%)</option>
            ))}
          </Select>
        </Field>
        <Field label="Selling Price" htmlFor="si-sell">
          <Input id="si-sell" type="number" step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
        </Field>
        <Field label="Cost Price" htmlFor="si-cost">
          <Input id="si-cost" type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
        </Field>
        <Field label="Reorder Level" htmlFor="si-reorder">
          <Input id="si-reorder" type="number" step="0.01" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
        </Field>
        <Field label="Safety Stock" htmlFor="si-safety">
          <Input id="si-safety" type="number" step="0.01" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !stockCode.trim() || !description.trim()} onClick={submit}>
          Create Stock Item
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function StockItemsTab({
  companyId,
  stockItems,
  warehouses,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  stockItems: StockItem[];
  warehouses: Warehouse[];
  vatTreatments: VatTreatment[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/inventory/stock-items`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const warehouseName = (id: number | null) => (id === null ? "—" : warehouses.find((w) => w.id === id)?.name ?? `#${id}`);

  const term = search.trim().toLowerCase();
  const filtered = stockItems.filter((i) => {
    if (statusFilter !== "All" && i.status !== statusFilter) return false;
    if (!term) return true;
    return i.stockCode.toLowerCase().includes(term) || i.description.toLowerCase().includes(term) || i.barcode.toLowerCase().includes(term);
  });

  async function setStatus(id: number, status: StockItemStatus) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-status", status }) });
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
        <div className="w-36">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search stock code, description, barcode…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stock items" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Stock Item
        </Button>
      </div>

      {showForm && (
        <StockItemFormPanel companyId={companyId} warehouses={warehouses} vatTreatments={vatTreatments} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconArchive className="h-5 w-5" />} title="No stock items." description="No stock items match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Stock Code</TableHeadCell>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell>Warehouse</TableHeadCell>
              <TableHeadCell className="text-right">On Hand</TableHeadCell>
              <TableHeadCell className="text-right">Avg. Cost</TableHeadCell>
              <TableHeadCell className="text-right">Inventory Value</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs font-medium text-vf-ink">{item.stockCode}</TableCell>
                <TableCell>{item.description}</TableCell>
                <TableCell>{warehouseName(item.defaultWarehouseId)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{item.quantityOnHand}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(item.averageCost)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(item.quantityOnHand * item.averageCost)}</TableCell>
                <TableCell><Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {item.status === "Active" ? (
                    <Button variant="subtle" size="sm" disabled={previewMode || loadingId === item.id} title={disabledTitle} onClick={() => setStatus(item.id, "Inactive")}>
                      Deactivate
                    </Button>
                  ) : item.status === "Inactive" ? (
                    <Button variant="subtle" size="sm" disabled={previewMode || loadingId === item.id} title={disabledTitle} onClick={() => setStatus(item.id, "Active")}>
                      Reactivate
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
