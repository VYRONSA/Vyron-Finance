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
import type { SalesInvoice, SalesInvoiceDocumentType, SalesInvoiceStatus } from "@/server/sales/types";
import type { VatTreatment } from "@/server/company-management/types";

const INVOICE_TEMPLATE_BY_DOCUMENT: Record<SalesInvoiceDocumentType, string> = {
  Invoice: "InvoiceEmail",
  "Credit Note": "CreditNoteEmail",
  "Debit Note": "DebitNoteEmail",
};

const DOCUMENT_TYPES: SalesInvoiceDocumentType[] = ["Invoice", "Credit Note", "Debit Note"];
const STATUS_OPTIONS: (SalesInvoiceStatus | "All")[] = ["All", "Draft", "Submitted", "Approved", "Posted", "Cancelled"];
const STATUS_TONE: Record<SalesInvoiceStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type EditableLine = { description: string; quantity: string; unitPrice: string };
const BLANK_LINE: EditableLine = { description: "", quantity: "1", unitPrice: "" };

function InvoiceFormPanel({
  companyId,
  customers,
  vatTreatments,
  onDone,
  onCancel,
}: {
  companyId: string;
  customers: Customer[];
  vatTreatments: VatTreatment[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? 0);
  const [documentType, setDocumentType] = useState<SalesInvoiceDocumentType>("Invoice");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [vatTreatmentCode, setVatTreatmentCode] = useState(vatTreatments[0]?.code ?? "");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([{ ...BLANK_LINE }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.round(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0) * 100) / 100;

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          documentType,
          invoiceDate,
          dueDate: dueDate || null,
          vatTreatmentCode,
          reference,
          lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 })),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Sales Document</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Customer" htmlFor="inv-customer" required className="lg:col-span-2">
          <Select id="inv-customer" value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.customerCode} — {c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Document Type" htmlFor="inv-type" required>
          <Select id="inv-type" value={documentType} onChange={(e) => setDocumentType(e.target.value as SalesInvoiceDocumentType)}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="inv-date" required>
          <Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Due Date" htmlFor="inv-due">
          <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="VAT Treatment" htmlFor="inv-vat" required>
          <Select id="inv-vat" value={vatTreatmentCode} onChange={(e) => setVatTreatmentCode(e.target.value)}>
            {vatTreatments.map((v) => (
              <option key={v.code} value={v.code}>{v.name} ({v.rate}%)</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Reference" htmlFor="inv-ref">
          <Input id="inv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input placeholder="Description" aria-label={`Description for line ${i + 1}`} value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
            </div>
            <div className="w-24">
              <Input type="number" step="0.01" placeholder="Qty" aria-label={`Quantity for line ${i + 1}`} value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
            </div>
            <div className="w-32">
              <Input type="number" step="0.01" placeholder="Unit Price" aria-label={`Unit price for line ${i + 1}`} value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
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

      <p className="mt-3 font-mono text-sm font-semibold tabular-nums text-vf-ink">Total (excl. VAT): {money(total)}</p>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !customerId || !vatTreatmentCode || total <= 0} onClick={submit}>
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

export function InvoicesTab({
  companyId,
  invoices,
  customers,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  invoices: SalesInvoice[];
  customers: Customer[];
  vatTreatments: VatTreatment[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [documentTypeFilter, setDocumentTypeFilter] = useState<SalesInvoiceDocumentType | "All">("All");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/sales/invoices`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? `Customer #${id}`;

  const term = search.trim().toLowerCase();
  const filtered = invoices.filter((i) => {
    if (documentTypeFilter !== "All" && i.documentType !== documentTypeFilter) return false;
    if (statusFilter !== "All" && i.status !== statusFilter) return false;
    if (!term) return true;
    return i.invoiceNumber.toLowerCase().includes(term) || customerName(i.customerId).toLowerCase().includes(term) || i.reference.toLowerCase().includes(term);
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
          <Select aria-label="Filter by document type" value={documentTypeFilter} onChange={(e) => setDocumentTypeFilter(e.target.value as SalesInvoiceDocumentType | "All")}>
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
          <Input placeholder="Search document #, customer, reference…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sales documents" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || customers.length === 0 || vatTreatments.length === 0} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Document
        </Button>
      </div>

      {showForm && (
        <InvoiceFormPanel companyId={companyId} customers={customers} vatTreatments={vatTreatments} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No sales documents." description="No invoices, credit notes, or debit notes match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell><span className="sr-only">Expand</span></TableHeadCell>
              <TableHeadCell>Document #</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Customer</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Due Date</TableHeadCell>
              <TableHeadCell className="text-right">Total</TableHeadCell>
              <TableHeadCell className="text-right">Outstanding</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((i) => {
              const isExpanded = expandedId === i.id;
              return (
                <Fragment key={i.id}>
                  <TableRow>
                    <TableCell>
                      <button type="button" aria-label={isExpanded ? `Collapse ${i.invoiceNumber}` : `Expand ${i.invoiceNumber}`} onClick={() => setExpandedId(isExpanded ? null : i.id)} className="text-vf-ink-faint hover:text-vf-ink">
                        {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronLeft className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-vf-ink">{i.invoiceNumber}</TableCell>
                    <TableCell>{i.documentType}</TableCell>
                    <TableCell>{customerName(i.customerId)}</TableCell>
                    <TableCell>{i.invoiceDate}</TableCell>
                    <TableCell>{i.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(i.total)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(i.outstanding)}</TableCell>
                    <TableCell><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {i.status === "Draft" && (
                          <>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === i.id} title={disabledTitle} onClick={() => runAction(i.id, "submit")}>
                              Submit
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === i.id} title={disabledTitle} onClick={() => runAction(i.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {i.status === "Submitted" && (
                          <>
                            <Button variant="primary" size="sm" disabled={previewMode || loadingId === i.id} title={disabledTitle} onClick={() => runAction(i.id, "approve")}>
                              Approve &amp; Post
                            </Button>
                            <Button variant="subtle" size="sm" disabled={previewMode || loadingId === i.id} title={disabledTitle} onClick={() => runAction(i.id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {i.status === "Approved" && (
                          <Button variant="subtle" size="sm" disabled={previewMode || loadingId === i.id} title={disabledTitle} onClick={() => runAction(i.id, "retry-post")}>
                            Retry Posting
                          </Button>
                        )}
                        {i.status === "Posted" && (
                          <SendCommunicationButton
                            companyId={companyId}
                            module="Sales"
                            businessObjectType="SalesInvoice"
                            businessObjectId={i.id}
                            templateCode={INVOICE_TEMPLATE_BY_DOCUMENT[i.documentType]}
                            recipients={[{ type: "Customer", id: i.customerId, name: customerName(i.customerId), address: null }]}
                            variables={{ customerName: customerName(i.customerId), invoiceNumber: i.invoiceNumber, total: money(i.total), dueDate: i.dueDate ?? "" }}
                            previewMode={previewMode}
                            buttonLabel={`Email ${i.documentType}`}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-vf-paper-alt/40">
                        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-2">
                          <div>
                            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Lines</p>
                            <table className="w-full text-xs">
                              <tbody>
                                {i.lines.map((line) => (
                                  <tr key={line.id} className="border-b border-vf-paper-border/60">
                                    <td className="py-1 pr-2 text-vf-ink-soft">{line.description}</td>
                                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{line.quantity}</td>
                                    <td className="py-1 pr-2 text-right font-mono tabular-nums">{money(line.unitPrice)}</td>
                                    <td className="py-1 text-right font-mono tabular-nums">{money(line.lineTotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mt-2 text-xs text-vf-ink-faint">
                              Subtotal {money(i.subtotal)} · VAT {money(i.vatAmount)} · Total {money(i.total)}
                            </p>
                          </div>
                          <div className="text-xs text-vf-ink-faint">
                            <p className="mb-1.5 font-medium uppercase tracking-wide">History</p>
                            {i.submittedAt && <p>Submitted {i.submittedBy ? `by ${i.submittedBy} ` : ""}— {new Date(i.submittedAt).toLocaleString()}</p>}
                            {i.approvedAt && <p>Approved {i.approvedBy ? `by ${i.approvedBy} ` : ""}— {new Date(i.approvedAt).toLocaleString()}</p>}
                            {i.postedAt && <p>Posted — {new Date(i.postedAt).toLocaleString()}</p>}
                            {i.cancelledAt && <p>Cancelled {i.cancelledBy ? `by ${i.cancelledBy} ` : ""}— {new Date(i.cancelledAt).toLocaleString()}</p>}
                            {i.journalId !== null && <p className="mt-1">Journal #{i.journalId}</p>}
                          </div>
                        </div>
                        <div className="mt-3">
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="SalesInvoice" businessObjectId={i.id} previewMode={previewMode} />
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
