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
import { BatchEntryGrid, type GridColumn } from "@/components/financial/shared/batch-entry-grid";
import type { BillPostingStatus, ImportedBill, PurchaseBillLine, Supplier } from "@/server/accounting/types";
import type { CostCentre, Department, Project, VatTreatment } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

const DOCUMENT_TYPES: ImportedBill["documentType"][] = ["Bill", "Credit Note", "Debit Note"];
const STATUS_OPTIONS: (BillPostingStatus | "All")[] = ["All", "Draft", "Submitted", "Approved", "Posted", "Cancelled"];
const STATUS_TONE: Record<BillPostingStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** One capture-grid row — "Additional Requirement: Purchase
 * Processing": unlimited lines, each independently allocated to a GL
 * account, VAT code, and (optionally — "where applicable") a cost
 * centre/project/department. IDs are held as strings (grid select
 * values are always strings) and converted back to number|null at
 * submit time. */
type BillLineRow = {
  rowId: string;
  description: string;
  glAccount: string;
  vatCode: string;
  costCentreId: string;
  projectId: string;
  departmentId: string;
  quantity: number;
  unitCost: number;
  discount: number;
};

let lineRowSeq = 0;
function createEmptyBillLineRow(defaultVatCode: string): BillLineRow {
  lineRowSeq += 1;
  return {
    rowId: `line-${lineRowSeq}`,
    description: "",
    glAccount: "",
    vatCode: defaultVatCode,
    costCentreId: "",
    projectId: "",
    departmentId: "",
    quantity: 1,
    unitCost: 0,
    discount: 0,
  };
}

function computeLineTotals(row: BillLineRow, vatTreatments: VatTreatment[]) {
  const rate = vatTreatments.find((v) => v.code === row.vatCode)?.rate ?? 0;
  const net = Math.round((row.quantity * row.unitCost - row.discount) * 100) / 100;
  const vat = Math.round(net * (rate / 100) * 100) / 100;
  return { net, vat, total: Math.round((net + vat) * 100) / 100 };
}

function BillFormPanel({
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
  const [documentType, setDocumentType] = useState<ImportedBill["documentType"]>("Bill");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<BillLineRow[]>(() => [createEmptyBillLineRow(vatTreatments[0]?.code ?? "")]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const glOptions = useMemo(() => chartOfAccounts.filter((a) => a.isActive).map((a) => ({ value: a.accountCode, label: `${a.accountCode} — ${a.description}` })), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatTreatments.map((v) => ({ value: v.code, label: `${v.name} (${v.rate}%)` })), [vatTreatments]);
  const costCentreOptions = useMemo(() => costCentres.filter((c) => c.isActive).map((c) => ({ value: String(c.id), label: c.name })), [costCentres]);
  const projectOptions = useMemo(() => projects.filter((p) => p.isActive).map((p) => ({ value: String(p.id), label: p.name })), [projects]);
  const departmentOptions = useMemo(() => departments.filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: d.name })), [departments]);

  const columns: GridColumn<BillLineRow>[] = [
    { key: "description", label: "Description", type: "text" },
    { key: "glAccount", label: "GL Account", type: "select", options: glOptions, placeholder: "Select account…" },
    { key: "vatCode", label: "VAT Code", type: "select", options: vatOptions, placeholder: "Select VAT…", width: "w-40" },
    { key: "costCentreId", label: "Cost Centre", type: "select", options: costCentreOptions, placeholder: "None", width: "w-36" },
    { key: "projectId", label: "Project", type: "select", options: projectOptions, placeholder: "None", width: "w-36" },
    { key: "departmentId", label: "Department", type: "select", options: departmentOptions, placeholder: "None", width: "w-36" },
    { key: "quantity", label: "Qty", type: "number", align: "right", width: "w-20" },
    { key: "unitCost", label: "Unit Cost", type: "number", align: "right", width: "w-28" },
    { key: "discount", label: "Discount", type: "number", align: "right", width: "w-28" },
  ];

  const computedLines = useMemo(() => lines.map((row) => ({ row, ...computeLineTotals(row, vatTreatments) })), [lines, vatTreatments]);
  const validLines = computedLines.filter((l) => l.row.glAccount && l.row.vatCode && l.net > 0);
  const subtotal = Math.round(validLines.reduce((s, l) => s + l.net, 0) * 100) / 100;
  const vatTotal = Math.round(validLines.reduce((s, l) => s + l.vat, 0) * 100) / 100;
  const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          documentType,
          invoiceNumber,
          invoiceDate,
          dueDate: dueDate || null,
          lines: validLines.map(({ row }) => ({
            description: row.description,
            glAccount: row.glAccount,
            vatCode: row.vatCode,
            costCentreId: row.costCentreId ? Number(row.costCentreId) : null,
            projectId: row.projectId ? Number(row.projectId) : null,
            departmentId: row.departmentId ? Number(row.departmentId) : null,
            quantity: row.quantity,
            unitCost: row.unitCost,
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Supplier Document</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Supplier" htmlFor="bill-supplier" required className="lg:col-span-2">
          <Select id="bill-supplier" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Document Type" htmlFor="bill-type" required>
          <Select id="bill-type" value={documentType} onChange={(e) => setDocumentType(e.target.value as ImportedBill["documentType"])}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier's Invoice #" htmlFor="bill-invnum" required>
          <Input id="bill-invnum" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
        <Field label="Date" htmlFor="bill-date" required>
          <Input id="bill-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 max-w-xs">
        <Field label="Due Date" htmlFor="bill-due">
          <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Lines</p>
        <BatchEntryGrid
          columns={columns}
          rows={lines}
          onRowsChange={setLines}
          createEmptyRow={() => createEmptyBillLineRow(vatTreatments[0]?.code ?? "")}
          getRowId={(row) => row.rowId}
          emptyLabel="Add at least one line — capture the whole document before posting, not one item at a time."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-vf-md bg-vf-paper-alt px-3 py-2 text-sm">
        <span>Subtotal <span className="font-mono font-medium tabular-nums">{money(subtotal)}</span></span>
        <span>VAT <span className="font-mono font-medium tabular-nums">{money(vatTotal)}</span></span>
        <span>Total <span className="font-mono font-semibold tabular-nums">{money(grandTotal)}</span></span>
        <span className="text-vf-ink-faint">{validLines.length} valid line{validLines.length === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !supplierId || !invoiceNumber.trim() || validLines.length === 0} onClick={submit}>
          Create {documentType}
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

function billLineToRow(line: PurchaseBillLine): BillLineRow {
  return {
    rowId: `existing-${line.id}`,
    description: line.description,
    glAccount: line.glAccount,
    vatCode: line.vatCode,
    costCentreId: line.costCentreId !== null ? String(line.costCentreId) : "",
    projectId: line.projectId !== null ? String(line.projectId) : "",
    departmentId: line.departmentId !== null ? String(line.departmentId) : "",
    quantity: line.quantity,
    unitCost: line.unitCost,
    discount: line.discount,
  };
}

/** Product Review Board certification — "Correct editing." Only ever
 * rendered for a Draft bill (see `BillsTab`'s own gating) — edits the
 * line set through `PATCH .../bills/[billId]` with `action:
 * "update-lines"`, reusing the same grid/columns/totals-footer logic as
 * `BillFormPanel`'s create flow rather than a second implementation. */
function EditBillLinesPanel({
  companyId,
  bill,
  initialLines,
  vatTreatments,
  chartOfAccounts,
  costCentres,
  projects,
  departments,
  onDone,
  onCancel,
}: {
  companyId: string;
  bill: ImportedBill;
  initialLines: PurchaseBillLine[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  costCentres: CostCentre[];
  projects: Project[];
  departments: Department[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState<BillLineRow[]>(() => (initialLines.length > 0 ? initialLines.map(billLineToRow) : [createEmptyBillLineRow(vatTreatments[0]?.code ?? "")]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const glOptions = useMemo(() => chartOfAccounts.filter((a) => a.isActive).map((a) => ({ value: a.accountCode, label: `${a.accountCode} — ${a.description}` })), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatTreatments.map((v) => ({ value: v.code, label: `${v.name} (${v.rate}%)` })), [vatTreatments]);
  const costCentreOptions = useMemo(() => costCentres.filter((c) => c.isActive).map((c) => ({ value: String(c.id), label: c.name })), [costCentres]);
  const projectOptions = useMemo(() => projects.filter((p) => p.isActive).map((p) => ({ value: String(p.id), label: p.name })), [projects]);
  const departmentOptions = useMemo(() => departments.filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: d.name })), [departments]);

  const columns: GridColumn<BillLineRow>[] = [
    { key: "description", label: "Description", type: "text" },
    { key: "glAccount", label: "GL Account", type: "select", options: glOptions, placeholder: "Select account…" },
    { key: "vatCode", label: "VAT Code", type: "select", options: vatOptions, placeholder: "Select VAT…", width: "w-40" },
    { key: "costCentreId", label: "Cost Centre", type: "select", options: costCentreOptions, placeholder: "None", width: "w-36" },
    { key: "projectId", label: "Project", type: "select", options: projectOptions, placeholder: "None", width: "w-36" },
    { key: "departmentId", label: "Department", type: "select", options: departmentOptions, placeholder: "None", width: "w-36" },
    { key: "quantity", label: "Qty", type: "number", align: "right", width: "w-20" },
    { key: "unitCost", label: "Unit Cost", type: "number", align: "right", width: "w-28" },
    { key: "discount", label: "Discount", type: "number", align: "right", width: "w-28" },
  ];

  const computedLines = useMemo(() => lines.map((row) => ({ row, ...computeLineTotals(row, vatTreatments) })), [lines, vatTreatments]);
  const validLines = computedLines.filter((l) => l.row.glAccount && l.row.vatCode && l.net > 0);
  const subtotal = Math.round(validLines.reduce((s, l) => s + l.net, 0) * 100) / 100;
  const vatTotal = Math.round(validLines.reduce((s, l) => s + l.vat, 0) * 100) / 100;
  const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/bills/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-lines",
          lines: validLines.map(({ row }) => ({
            description: row.description,
            glAccount: row.glAccount,
            vatCode: row.vatCode,
            costCentreId: row.costCentreId ? Number(row.costCentreId) : null,
            projectId: row.projectId ? Number(row.projectId) : null,
            departmentId: row.departmentId ? Number(row.departmentId) : null,
            quantity: row.quantity,
            unitCost: row.unitCost,
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">Editing {bill.invoiceNumber}</p>
      <BatchEntryGrid
        columns={columns}
        rows={lines}
        onRowsChange={setLines}
        createEmptyRow={() => createEmptyBillLineRow(vatTreatments[0]?.code ?? "")}
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

export function BillsTab({
  companyId,
  bills,
  suppliers,
  vatTreatments,
  chartOfAccounts,
  costCentres,
  projects,
  departments,
  previewMode,
}: {
  companyId: string;
  bills: ImportedBill[];
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  costCentres: CostCentre[];
  projects: Project[];
  departments: Department[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [documentTypeFilter, setDocumentTypeFilter] = useState<ImportedBill["documentType"] | "All">("All");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingLines, setEditingLines] = useState<PurchaseBillLine[] | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  async function startEditing(id: number) {
    setEditingLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/purchasing/bills/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setEditingLines(data.lines ?? []);
      setEditingId(id);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setEditingLoading(false);
    }
  }

  const base = `/api/companies/${companyId}/purchasing/bills`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const supplierName = (id: number | null) => suppliers.find((s) => s.id === id)?.name ?? (id === null ? "—" : `Supplier #${id}`);

  const term = search.trim().toLowerCase();
  const filtered = bills
    .filter((b) => b.origin === "Purchasing")
    .filter((b) => {
      if (documentTypeFilter !== "All" && b.documentType !== documentTypeFilter) return false;
      if (statusFilter !== "All" && b.postingStatus !== statusFilter) return false;
      if (!term) return true;
      return b.invoiceNumber.toLowerCase().includes(term) || supplierName(b.supplierId).toLowerCase().includes(term);
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
        <div className="w-36">
          <Select aria-label="Filter by document type" value={documentTypeFilter} onChange={(e) => setDocumentTypeFilter(e.target.value as ImportedBill["documentType"] | "All")}>
            <option value="All">All Documents</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Input placeholder="Search invoice #, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search supplier bills" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || suppliers.length === 0 || vatTreatments.length === 0 || chartOfAccounts.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Document
        </Button>
      </div>

      {showForm && (
        <BillFormPanel
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
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No supplier documents." description="No bills, credit notes, or debit notes entered through Purchasing match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Invoice #</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Supplier</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Due Date</TableHeadCell>
              <TableHeadCell className="text-right">Total</TableHeadCell>
              <TableHeadCell className="text-right">Outstanding</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((b) => {
              const isExpanded = expandedId === b.id;
              return (
                <Fragment key={b.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${b.invoiceNumber}` : `Expand ${b.invoiceNumber}`} onClick={() => setExpandedId(isExpanded ? null : b.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{b.invoiceNumber}</TableCell>
                    <TableCell>{b.documentType}</TableCell>
                    <TableCell>{supplierName(b.supplierId)}</TableCell>
                    <TableCell>{b.invoiceDate ?? "—"}</TableCell>
                    <TableCell>{b.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(b.total)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(b.outstanding)}</TableCell>
                    <TableCell>{b.postingStatus && <Badge tone={STATUS_TONE[b.postingStatus]}>{b.postingStatus}</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {b.postingStatus === "Draft" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === b.id || editingLoading} title={disabledTitle} onClick={() => startEditing(b.id)}>
                              Edit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === b.id} title={disabledTitle} onClick={() => runAction(b.id, "submit")}>
                              Submit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === b.id} title={disabledTitle} onClick={() => runAction(b.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {b.postingStatus === "Submitted" && (
                          <>
                            <Button variant="primary" size="sm" disabled={previewMode || loadingId === b.id} title={disabledTitle} onClick={() => runAction(b.id, "approve")}>
                              Approve &amp; Post
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === b.id} title={disabledTitle} onClick={() => runAction(b.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {b.postingStatus === "Approved" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === b.id} title={disabledTitle} onClick={() => runAction(b.id, "retry-post")}>
                            Retry Posting
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-vf-paper-alt/40">
                        <div className="text-xs text-vf-ink-faint">
                          <p>Subtotal {money(b.total - b.vat)} · VAT {money(b.vat)} · Total {money(b.total)}</p>
                          {b.purchaseOrderId !== null && <p className="mt-1">From Purchase Order #{b.purchaseOrderId}</p>}
                          {b.submittedAt && <p className="mt-1">Submitted {b.submittedBy ? `by ${b.submittedBy} ` : ""}— {new Date(b.submittedAt).toLocaleString()}</p>}
                          {b.approvedAt && <p>Approved {b.approvedBy ? `by ${b.approvedBy} ` : ""}— {new Date(b.approvedAt).toLocaleString()}</p>}
                          {b.postedAt && <p>Posted — {new Date(b.postedAt).toLocaleString()}</p>}
                          {b.cancelledAt && <p>Cancelled {b.cancelledBy ? `by ${b.cancelledBy} ` : ""}— {new Date(b.cancelledAt).toLocaleString()}</p>}
                          {b.journalId !== null && <p className="mt-1">Journal #{b.journalId}</p>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {editingId === b.id && editingLines !== null && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-vf-paper-alt/40">
                        <EditBillLinesPanel
                          companyId={companyId}
                          bill={b}
                          initialLines={editingLines}
                          vatTreatments={vatTreatments}
                          chartOfAccounts={chartOfAccounts}
                          costCentres={costCentres}
                          projects={projects}
                          departments={departments}
                          onDone={() => { setEditingId(null); setEditingLines(null); router.refresh(); }}
                          onCancel={() => { setEditingId(null); setEditingLines(null); }}
                        />
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
