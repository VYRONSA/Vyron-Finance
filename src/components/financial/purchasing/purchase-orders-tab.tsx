"use client";

import { Fragment, useMemo, useState } from "react";
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
import { BatchEntryGrid, type GridColumn } from "@/components/financial/shared/batch-entry-grid";
import type { Supplier } from "@/server/accounting/types";
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from "@/server/purchasing/types";
import type { CostCentre, Department, Project, VatTreatment } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const STATUS_OPTIONS: (PurchaseOrderStatus | "All")[] = ["All", "Draft", "Submitted", "Approved", "Rejected", "PartiallyReceived", "Received", "Billed", "Cancelled"];
const STATUS_TONE: Record<PurchaseOrderStatus, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "good",
  Rejected: "danger",
  PartiallyReceived: "warn",
  Received: "good",
  Billed: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** One capture-grid row — Product Review Board: the same multi-line
 * workflow as Bills (GL account, VAT code, cost centre, project,
 * department, quantity, unit cost, discount, running totals) applies
 * to Purchase Orders too, not just Bills/Credit Notes/Debit Notes.
 * Unlike a Bill line, GL/VAT here are optional — a PO never posts to
 * the GL by design, so a line with neither is still valid (budgetary/
 * commitment data only); dimensioning a line is what lets it flow
 * straight through to a real Bill line when the order is billed (see
 * `purchase-bill-service.ts::createBillFromOrder`). */
type OrderLineRow = {
  rowId: string;
  description: string;
  glAccount: string;
  vatCode: string;
  costCentreId: string;
  projectId: string;
  departmentId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

let orderLineRowSeq = 0;
function createEmptyOrderLineRow(): OrderLineRow {
  orderLineRowSeq += 1;
  return {
    rowId: `po-line-${orderLineRowSeq}`,
    description: "",
    glAccount: "",
    vatCode: "",
    costCentreId: "",
    projectId: "",
    departmentId: "",
    quantity: 1,
    unitPrice: 0,
    discount: 0,
  };
}

function computeOrderLineTotals(row: OrderLineRow, vatTreatments: VatTreatment[]) {
  const rate = vatTreatments.find((v) => v.code === row.vatCode)?.rate ?? 0;
  const net = Math.round((row.quantity * row.unitPrice - row.discount) * 100) / 100;
  const vat = Math.round(net * (rate / 100) * 100) / 100;
  return { net, vat, total: Math.round((net + vat) * 100) / 100 };
}

function OrderFormPanel({
  companyId,
  suppliers,
  vatTreatments,
  chartOfAccounts,
  costCentres,
  projects,
  departments,
  onDone,
  onCancel,
}: {
  companyId: string;
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  costCentres: CostCentre[];
  projects: Project[];
  departments: Department[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? 0);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<OrderLineRow[]>(() => [createEmptyOrderLineRow()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const glOptions = useMemo(() => chartOfAccounts.filter((a) => a.isActive).map((a) => ({ value: a.accountCode, label: `${a.accountCode} — ${a.description}` })), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatTreatments.map((v) => ({ value: v.code, label: `${v.name} (${v.rate}%)` })), [vatTreatments]);
  const costCentreOptions = useMemo(() => costCentres.filter((c) => c.isActive).map((c) => ({ value: String(c.id), label: c.name })), [costCentres]);
  const projectOptions = useMemo(() => projects.filter((p) => p.isActive).map((p) => ({ value: String(p.id), label: p.name })), [projects]);
  const departmentOptions = useMemo(() => departments.filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: d.name })), [departments]);

  const columns: GridColumn<OrderLineRow>[] = [
    { key: "description", label: "Description", type: "text" },
    { key: "glAccount", label: "GL Account", type: "select", options: glOptions, placeholder: "None" },
    { key: "vatCode", label: "VAT Code", type: "select", options: vatOptions, placeholder: "None", width: "w-40" },
    { key: "costCentreId", label: "Cost Centre", type: "select", options: costCentreOptions, placeholder: "None", width: "w-36" },
    { key: "projectId", label: "Project", type: "select", options: projectOptions, placeholder: "None", width: "w-36" },
    { key: "departmentId", label: "Department", type: "select", options: departmentOptions, placeholder: "None", width: "w-36" },
    { key: "quantity", label: "Qty", type: "number", align: "right", width: "w-20" },
    { key: "unitPrice", label: "Unit Price", type: "number", align: "right", width: "w-28" },
    { key: "discount", label: "Discount", type: "number", align: "right", width: "w-28" },
  ];

  const computedLines = useMemo(() => lines.map((row) => ({ row, ...computeOrderLineTotals(row, vatTreatments) })), [lines, vatTreatments]);
  const validLines = computedLines.filter((l) => l.row.description.trim() && l.net > 0);
  const subtotal = Math.round(validLines.reduce((s, l) => s + l.net, 0) * 100) / 100;
  const vatTotal = Math.round(validLines.reduce((s, l) => s + l.vat, 0) * 100) / 100;
  const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          orderDate,
          lines: validLines.map(({ row }) => ({
            description: row.description,
            glAccount: row.glAccount || null,
            vatCode: row.vatCode || null,
            costCentreId: row.costCentreId ? Number(row.costCentreId) : null,
            projectId: row.projectId ? Number(row.projectId) : null,
            departmentId: row.departmentId ? Number(row.departmentId) : null,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            discount: row.discount,
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Purchase Order</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="po-supplier" required>
          <Select id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Order Date" htmlFor="po-date" required>
          <Input id="po-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Lines</p>
        <BatchEntryGrid
          columns={columns}
          rows={lines}
          onRowsChange={setLines}
          createEmptyRow={createEmptyOrderLineRow}
          getRowId={(row) => row.rowId}
          emptyLabel="Add at least one line — capture the whole order before posting, not one item at a time."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-vf-md bg-vf-paper-alt px-3 py-2 text-sm">
        <span>Subtotal <span className="font-mono font-medium tabular-nums">{money(subtotal)}</span></span>
        <span>VAT <span className="font-mono font-medium tabular-nums">{money(vatTotal)}</span></span>
        <span>Total <span className="font-mono font-semibold tabular-nums">{money(grandTotal)}</span></span>
        <span className="text-vf-ink-faint">{validLines.length} valid line{validLines.length === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !supplierId || validLines.length === 0} onClick={submit}>
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

function orderLineToRow(line: PurchaseOrderLine): OrderLineRow {
  return {
    rowId: `existing-${line.id}`,
    description: line.description,
    glAccount: line.glAccount ?? "",
    vatCode: line.vatCode ?? "",
    costCentreId: line.costCentreId !== null ? String(line.costCentreId) : "",
    projectId: line.projectId !== null ? String(line.projectId) : "",
    departmentId: line.departmentId !== null ? String(line.departmentId) : "",
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
  };
}

/** Product Review Board certification — "Correct editing," parity with
 * `bills-tab.tsx::EditBillLinesPanel`. Only ever rendered for a Draft
 * order (see `PurchaseOrdersTab`'s own gating) — `order.lines` is
 * already embedded in the list response (unlike Bills, no separate
 * fetch needed), so this opens straight from what's already on screen. */
function EditOrderLinesPanel({
  companyId,
  order,
  vatTreatments,
  chartOfAccounts,
  costCentres,
  projects,
  departments,
  onDone,
  onCancel,
}: {
  companyId: string;
  order: PurchaseOrder;
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  costCentres: CostCentre[];
  projects: Project[];
  departments: Department[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState<OrderLineRow[]>(() => (order.lines.length > 0 ? order.lines.map(orderLineToRow) : [createEmptyOrderLineRow()]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const glOptions = useMemo(() => chartOfAccounts.filter((a) => a.isActive).map((a) => ({ value: a.accountCode, label: `${a.accountCode} — ${a.description}` })), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatTreatments.map((v) => ({ value: v.code, label: `${v.name} (${v.rate}%)` })), [vatTreatments]);
  const costCentreOptions = useMemo(() => costCentres.filter((c) => c.isActive).map((c) => ({ value: String(c.id), label: c.name })), [costCentres]);
  const projectOptions = useMemo(() => projects.filter((p) => p.isActive).map((p) => ({ value: String(p.id), label: p.name })), [projects]);
  const departmentOptions = useMemo(() => departments.filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: d.name })), [departments]);

  const columns: GridColumn<OrderLineRow>[] = [
    { key: "description", label: "Description", type: "text" },
    { key: "glAccount", label: "GL Account", type: "select", options: glOptions, placeholder: "None" },
    { key: "vatCode", label: "VAT Code", type: "select", options: vatOptions, placeholder: "None", width: "w-40" },
    { key: "costCentreId", label: "Cost Centre", type: "select", options: costCentreOptions, placeholder: "None", width: "w-36" },
    { key: "projectId", label: "Project", type: "select", options: projectOptions, placeholder: "None", width: "w-36" },
    { key: "departmentId", label: "Department", type: "select", options: departmentOptions, placeholder: "None", width: "w-36" },
    { key: "quantity", label: "Qty", type: "number", align: "right", width: "w-20" },
    { key: "unitPrice", label: "Unit Price", type: "number", align: "right", width: "w-28" },
    { key: "discount", label: "Discount", type: "number", align: "right", width: "w-28" },
  ];

  const computedLines = useMemo(() => lines.map((row) => ({ row, ...computeOrderLineTotals(row, vatTreatments) })), [lines, vatTreatments]);
  const validLines = computedLines.filter((l) => l.row.description.trim() && l.net > 0);
  const subtotal = Math.round(validLines.reduce((s, l) => s + l.net, 0) * 100) / 100;
  const vatTotal = Math.round(validLines.reduce((s, l) => s + l.vat, 0) * 100) / 100;
  const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-lines",
          lines: validLines.map(({ row }) => ({
            description: row.description,
            glAccount: row.glAccount || null,
            vatCode: row.vatCode || null,
            costCentreId: row.costCentreId ? Number(row.costCentreId) : null,
            projectId: row.projectId ? Number(row.projectId) : null,
            departmentId: row.departmentId ? Number(row.departmentId) : null,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            discount: row.discount,
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
      <BatchEntryGrid
        columns={columns}
        rows={lines}
        onRowsChange={setLines}
        createEmptyRow={createEmptyOrderLineRow}
        getRowId={(row) => row.rowId}
        emptyLabel="Add at least one line."
      />
      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-vf-md bg-vf-paper-alt px-3 py-2 text-sm">
        <span>Subtotal <span className="font-mono font-medium tabular-nums">{money(subtotal)}</span></span>
        <span>VAT <span className="font-mono font-medium tabular-nums">{money(vatTotal)}</span></span>
        <span>Total <span className="font-mono font-semibold tabular-nums">{money(grandTotal)}</span></span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || validLines.length === 0} onClick={save}>
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

function CreateBillPanel({
  companyId,
  order,
  defaultVatCode,
  onDone,
  onCancel,
}: {
  companyId: string;
  order: PurchaseOrder;
  defaultVatCode: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, invoiceNumber, invoiceDate, vatTreatmentCode: defaultVatCode }),
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
        <Field label="Supplier's Invoice Number" htmlFor={`po-bill-inv-${order.id}`} required>
          <Input id={`po-bill-inv-${order.id}`} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
      </div>
      <div className="w-40">
        <Field label="Invoice Date" htmlFor={`po-bill-date-${order.id}`} required>
          <Input id={`po-bill-date-${order.id}`} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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

export function PurchaseOrdersTab({
  companyId,
  orders,
  suppliers,
  vatTreatments,
  chartOfAccounts,
  costCentres,
  projects,
  departments,
  previewMode,
}: {
  companyId: string;
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  costCentres: CostCentre[];
  projects: Project[];
  departments: Department[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [billingId, setBillingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/purchasing/orders`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const supplierName = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;
  const defaultVatCode = vatTreatments[0]?.code ?? "Standard Rated";

  const term = search.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (statusFilter !== "All" && o.status !== statusFilter) return false;
    if (!term) return true;
    return o.orderNumber.toLowerCase().includes(term) || supplierName(o.supplierId).toLowerCase().includes(term);
  });

  async function runAction(id: number, action: "submit" | "approve" | "reject" | "cancel") {
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
        <div className="w-48">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search order #, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search purchase orders" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || suppliers.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Order
        </Button>
      </div>

      {showForm && (
        <OrderFormPanel
          companyId={companyId}
          suppliers={suppliers}
          vatTreatments={vatTreatments}
          chartOfAccounts={chartOfAccounts}
          costCentres={costCentres}
          projects={projects}
          departments={departments}
          onDone={() => { setShowForm(false); router.refresh(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No purchase orders." description="No purchase orders match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Order #</TableHeadCell>
              <TableHeadCell>Supplier</TableHeadCell>
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
                      {o.requisitionId !== null && <span className="ml-1.5 text-[10px] text-vf-ink-faint">from PR</span>}
                    </TableCell>
                    <TableCell>{supplierName(o.supplierId)}</TableCell>
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
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => runAction(o.id, "submit")}>
                              Submit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => runAction(o.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {o.status === "Submitted" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => runAction(o.id, "approve")}>
                              Approve
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => runAction(o.id, "reject")}>
                              Reject
                            </Button>
                          </>
                        )}
                        {(o.status === "Approved" || o.status === "PartiallyReceived") && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === o.id} title={disabledTitle} onClick={() => runAction(o.id, "cancel")}>
                            Cancel
                          </Button>
                        )}
                        {o.status === "Received" && (
                          <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setBillingId(billingId === o.id ? null : o.id)}>
                            Create Bill
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {billingId === o.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <CreateBillPanel companyId={companyId} order={o} defaultVatCode={defaultVatCode} onDone={() => { setBillingId(null); router.refresh(); }} onCancel={() => setBillingId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                  {editingId === o.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-vf-paper-alt/40">
                        <EditOrderLinesPanel
                          companyId={companyId}
                          order={o}
                          vatTreatments={vatTreatments}
                          chartOfAccounts={chartOfAccounts}
                          costCentres={costCentres}
                          projects={projects}
                          departments={departments}
                          onDone={() => { setEditingId(null); router.refresh(); }}
                          onCancel={() => setEditingId(null)}
                        />
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
                              <th className="py-1 pr-2 text-right font-medium">Received</th>
                              <th className="py-1 pr-2 text-right font-medium">Billed</th>
                              <th className="py-1 text-right font-medium">Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.lines.map((line) => (
                              <tr key={line.id} className="border-b border-vf-paper-border/60">
                                <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.quantity}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.receivedQuantity}</td>
                                <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.billedQuantity}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{money(line.lineTotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-3 flex flex-col gap-3">
                          <SendCommunicationButton
                            companyId={companyId}
                            module="Purchasing"
                            businessObjectType="PurchaseOrder"
                            businessObjectId={o.id}
                            templateCode="PurchaseOrderEmail"
                            recipients={[{ type: "Supplier", id: o.supplierId, name: supplierName(o.supplierId), address: null }]}
                            variables={{ supplierName: supplierName(o.supplierId), orderNumber: o.orderNumber, total }}
                            previewMode={previewMode}
                            buttonLabel="Email Order"
                          />
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="PurchaseOrder" businessObjectId={o.id} previewMode={previewMode} />
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
