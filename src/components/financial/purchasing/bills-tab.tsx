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
import type { BillPostingStatus, ImportedBill, Supplier } from "@/server/accounting/types";
import type { VatTreatment } from "@/server/company-management/types";

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

function BillFormPanel({
  companyId,
  suppliers,
  vatTreatments,
  onDone,
  onCancel,
}: {
  companyId: string;
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? 0);
  const [documentType, setDocumentType] = useState<ImportedBill["documentType"]>("Bill");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [vatTreatmentCode, setVatTreatmentCode] = useState(vatTreatments[0]?.code ?? "");
  const [subtotal, setSubtotal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          vatTreatmentCode,
          subtotal: Number(subtotal) || 0,
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
        <Field label="Due Date" htmlFor="bill-due">
          <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="VAT Treatment" htmlFor="bill-vat" required>
          <Select id="bill-vat" value={vatTreatmentCode} onChange={(e) => setVatTreatmentCode(e.target.value)}>
            {vatTreatments.map((v) => (
              <option key={v.code} value={v.code}>{v.name} ({v.rate}%)</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (excl. VAT)" htmlFor="bill-subtotal" required>
          <Input id="bill-subtotal" type="number" step="0.01" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !supplierId || !invoiceNumber.trim() || !vatTreatmentCode || (Number(subtotal) || 0) <= 0} onClick={submit}>
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

export function BillsTab({
  companyId,
  bills,
  suppliers,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  bills: ImportedBill[];
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
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
        <Button variant="primary" size="sm" disabled={previewMode || suppliers.length === 0 || vatTreatments.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Document
        </Button>
      </div>

      {showForm && (
        <BillFormPanel companyId={companyId} suppliers={suppliers} vatTreatments={vatTreatments} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />
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
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
