"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { customerOptions, glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import { computeInvoiceTotalsFromCodes } from "@/server/sales/invoice-totals";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChevronDown, IconChevronLeft, IconFileText, IconPlus } from "@/components/ui/icons";
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";
import { CommunicationHistoryPanel } from "@/components/financial/communications/communication-history-panel";
import { DocumentsPanel } from "@/components/financial/documents/documents-panel";
import { InvoiceDocument } from "@/components/documents/invoice-document";
import { isPostedRepairCandidate, PostedLineAccountsBulkRepair } from "@/components/financial/sales/posted-line-accounts-bulk";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice, SalesInvoiceDocumentType, SalesInvoiceStatus } from "@/server/sales/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import { formatAmount, formatDateTime } from "@/lib/format";

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
  return formatAmount(value);
}

type EditableLine = { description: string; quantity: string; unitPrice: string; glAccount: string | null; vatCode: string | null; discount: string };
const BLANK_LINE: EditableLine = { description: "", quantity: "1", unitPrice: "", glAccount: null, vatCode: null, discount: "0" };

export type InvoiceFormErrors = {
  customerId?: string;
  invoiceDate?: string;
  dueDate?: string;
  /** Phase 5J — the two particulars VAT Act s21(3) requires on a credit
   * or debit note. */
  originalInvoiceId?: string;
  reason?: string;
  /** Per-line messages, keyed by line index. */
  lines?: Record<number, { description?: string; quantity?: string; unitPrice?: string; discount?: string }>;
};

/** Phase 5I — client-side validation for the fields the form already has.
 *
 * Pure and exported so it is testable without mounting the screen. It
 * deliberately mirrors the server's own rules
 * (`sales-invoice-service.ts::validateInvoiceLines` and the required-field
 * checks above it) rather than inventing new ones — the server stays the
 * authority and re-checks all of this; this exists so the person is told
 * WHICH field is wrong before a round trip, instead of getting one
 * sentence at the bottom of the panel.
 *
 * Phase 5J — it now also checks the two things that became accounting
 * inputs this phase: a discount has to be a real amount within the line
 * it reduces (it changes the VAT charged), and a credit or debit note has
 * to carry the particulars VAT Act s21(3) requires. Both mirror
 * `sales-invoice-service.ts`'s own rules; neither replaces them. */
export function validateInvoiceForm(input: {
  customerId: number;
  invoiceDate: string;
  dueDate: string;
  lines: EditableLine[];
  documentType?: SalesInvoiceDocumentType;
  originalInvoiceId?: number | null;
  reason?: string;
}): InvoiceFormErrors {
  const errors: InvoiceFormErrors = {};

  if (!input.customerId) errors.customerId = "Choose the customer this document is for.";
  if (!input.invoiceDate) errors.invoiceDate = "An invoice date is required.";

  if (input.documentType && input.documentType !== "Invoice") {
    const noun = input.documentType === "Credit Note" ? "credit note" : "debit note";
    if (!input.originalInvoiceId) errors.originalInvoiceId = `Choose the invoice this ${noun} adjusts.`;
    if (!input.reason?.trim()) errors.reason = `Say why this ${noun} is being issued.`;
  }
  // A due date is optional — but a due date BEFORE the invoice date is
  // always a mistake, and it would feed AR ageing.
  if (input.dueDate && input.invoiceDate && input.dueDate < input.invoiceDate) {
    errors.dueDate = "The due date cannot be before the invoice date.";
  }

  const lineErrors: Record<number, { description?: string; quantity?: string; unitPrice?: string; discount?: string }> = {};
  input.lines.forEach((line, i) => {
    const e: { description?: string; quantity?: string; unitPrice?: string; discount?: string } = {};
    if (!line.description.trim()) e.description = "Describe what is being charged for.";

    const qty = Number(line.quantity);
    if (line.quantity.trim() === "" || Number.isNaN(qty)) e.quantity = "Enter a quantity.";
    else if (qty <= 0) e.quantity = "Quantity must be more than zero.";

    const price = Number(line.unitPrice);
    if (line.unitPrice.trim() === "" || Number.isNaN(price)) e.unitPrice = "Enter a unit price.";
    else if (price < 0) e.unitPrice = "Unit price cannot be negative.";

    // Phase 5J — a discount now reduces the charge AND the VAT on it, so
    // it can no longer be any number someone types. Same bounds the
    // server enforces.
    const discount = Number(line.discount);
    if (line.discount.trim() !== "") {
      if (Number.isNaN(discount) || discount < 0) e.discount = "A discount cannot be negative.";
      else if (!Number.isNaN(qty) && !Number.isNaN(price) && discount > Math.round(qty * price * 100) / 100) {
        e.discount = "A discount cannot be more than the line.";
      }
    }

    if (Object.keys(e).length > 0) lineErrors[i] = e;
  });
  if (Object.keys(lineErrors).length > 0) errors.lines = lineErrors;

  return errors;
}

function InvoiceFormPanel({
  companyId,
  customers,
  vatTreatments,
  chartOfAccounts,
  invoices,
  onDone,
  onCancel,
}: {
  companyId: string;
  customers: Customer[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  invoices: SalesInvoice[];
  onDone: () => void;
  onCancel: () => void;
}) {
  // Phase 5I — NO default customer. This used to be `customers[0]?.id`,
  // so a form opened and saved without touching the customer field
  // silently billed whichever customer happened to sort first. An invoice
  // is a legal document naming a party; that party must be chosen on
  // purpose. `0` means "nothing chosen" and the form refuses to submit.
  const [customerId, setCustomerId] = useState(0);
  const activeCustomerOptions = customerOptions(customers.filter((c) => c.isActive));
  const [documentType, setDocumentType] = useState<SalesInvoiceDocumentType>("Invoice");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [vatTreatmentCode, setVatTreatmentCode] = useState(vatTreatments[0]?.code ?? "");
  const [reference, setReference] = useState("");
  // Phase 5I — `notes` already existed in the API, the database and the
  // printed document; only the form never offered it, so nothing typed on
  // an invoice could ever reach the page it prints on.
  const [notes, setNotes] = useState("");
  const [originalInvoiceId, setOriginalInvoiceId] = useState<number | null>(null);
  // Phase 5J — VAT Act s21(3)(a)(vi)/(b)(vi): a credit or debit note must
  // carry "a brief explanation of the circumstances giving rise to" it.
  // There was nowhere to record one, so no note this system issued could
  // satisfy that.
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([{ ...BLANK_LINE }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Phase 5I — set once Save has been attempted, so the form does not
   * scold someone about fields they have not reached yet. */
  const [attempted, setAttempted] = useState(false);
  const glOptions = glAccountOptions(chartOfAccounts);
  const vatOptions = vatCodeOptions(vatTreatments);
  const invoiceOptions = invoices.filter((i) => i.documentType === "Invoice" && i.customerId === customerId).map((i) => ({ value: i.id, label: i.invoiceNumber, sublabel: money(i.total) }));

  /* Phase 5J — the preview runs THE server's calculation, not a second
   * one. `computeInvoiceTotalsFromCodes` is the same module
   * `sales-invoice-service.ts` uses, imported directly (it depends on
   * nothing but pure arithmetic, so it bundles for the client), against
   * the same `vat_treatments` rates the server will resolve.
   *
   * The server still recomputes everything on save and stores ITS result.
   * This is a preview so the figures are not a surprise — it is not an
   * input to anything. An unknown VAT code falls back to showing zeros
   * rather than throwing; the server names the offending code. */
  const previewRates = new Map(vatTreatments.map((v) => [v.code, v.rate]));
  const headerRate = vatTreatments.find((v) => v.code === vatTreatmentCode)?.rate ?? 0;
  const preview = computeInvoiceTotalsFromCodes(
    lines.map((l) => ({
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      discount: Number(l.discount) || 0,
      vatCode: l.vatCode,
    })),
    headerRate,
    previewRates,
  );
  const totals = preview.ok ? preview.totals : { subtotal: 0, discountTotal: 0, vatAmount: 0, total: 0, lines: [] };
  const total = totals.total;

  const errors = validateInvoiceForm({ customerId, invoiceDate, dueDate, lines, documentType, originalInvoiceId, reason });
  const hasErrors = Object.keys(errors).length > 0 || errors.lines !== undefined;
  /** A field's message, but only once Save has been attempted — the form
   * should not scold someone about fields they have not reached yet.
   * Typed to the single-message keys so it can never be handed the
   * per-line record by mistake. */
  const show = (key: "customerId" | "invoiceDate" | "dueDate"): string | undefined => (attempted ? errors[key] : undefined);

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setAttempted(true);
    // Client validation COMPLEMENTS the server's — it never replaces it.
    // The server re-validates every one of these (customer, date, VAT
    // treatment, line description, quantity > 0, unit price >= 0) and is
    // still the authority; this just stops a round trip and points at the
    // field rather than showing one message at the bottom.
    if (hasErrors) return;
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
          notes,
          // Phase 5J — a Debit Note references and explains its original
          // invoice too (s21(3)(b)), not just a Credit Note.
          originalInvoiceId: documentType === "Invoice" ? null : originalInvoiceId,
          reason: documentType === "Invoice" ? "" : reason,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 0,
            unitPrice: Number(l.unitPrice) || 0,
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Sales Document</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Customer" htmlFor="inv-customer" required className="lg:col-span-2" error={show("customerId")}>
          {/* Finding #200 — see deliveries-tab.tsx's identical note.
              Finding #167 — searchable Combobox instead of a plain Select. */}
          {/* Phase 5I — placeholder reflects what can now be searched. */}
          <Combobox aria-label="Customer" value={customerId || null} options={activeCustomerOptions} placeholder="Search name, code, VAT or registration no…" onCommit={(val) => setCustomerId(val ?? 0)} />
          {/* Phase 5I — the invoice form deliberately does NOT create a
              customer inline. A customer captured in a hurry, with a name
              and nothing else, lacks the recipient's VAT number and address
              that a tax invoice needs (VAT Act s.20(4)(c)), and is how one
              customer ends up duplicated with their balance split across two
              records. Instead: say why the list is empty and point at the
              screen that captures a customer properly. */}
          {/* The panel cannot be opened at all with no customers — the New
              Document button refuses. What DOES reach here is a company
              whose customers all happen to be inactive: the button opens,
              the list is empty, and nothing says why. */}
          {activeCustomerOptions.length === 0 && (
            <p className="mt-1 text-xs text-vf-ink-faint">
              Every customer on file is marked inactive.{" "}
              <a className="font-medium underline hover:text-vf-red-600" href={`/company/${companyId}/customers`}>
                Go to Customers
              </a>
            </p>
          )}
        </Field>
        <Field label="Document Type" htmlFor="inv-type" required>
          <Select id="inv-type" value={documentType} onChange={(e) => setDocumentType(e.target.value as SalesInvoiceDocumentType)}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="inv-date" required error={show("invoiceDate")}>
          <Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Due Date" htmlFor="inv-due" error={show("dueDate")}>
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
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Reference" htmlFor="inv-ref">
          <Input id="inv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {/* Phase 5I — `notes` already existed in the API, the database and
            the printed document; the form simply never offered it. */}
        <Field label="Notes" htmlFor="inv-notes">
          <Input id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the printed document" />
        </Field>
        {documentType !== "Invoice" && (
          /* Finding #114 added the link; Phase 5J makes it required and
             extends it to Debit Notes.
             VAT Act s21(3) requires a credit or debit note to carry
             "information sufficient to identify the transaction to which
             [it] refers" (a)(vii)/(b)(vii) and "a brief explanation of the
             circumstances giving rise to" it (a)(vi)/(b)(vi). SARS's own
             worked examples in VAT 404 satisfy the first with the original
             tax invoice's number and date.
             It used to be optional, on the reasoning that a general
             goodwill credit names no invoice. That is not a document this
             system can issue compliantly, so the field is now required
             rather than quietly producing a non-compliant note. */
          <>
            <Field label="Original Invoice" htmlFor="inv-original" required error={attempted ? errors.originalInvoiceId : undefined}>
              <Combobox aria-label="Original Invoice" value={originalInvoiceId} options={invoiceOptions} placeholder="Choose the invoice being adjusted" onCommit={setOriginalInvoiceId} />
            </Field>
            <Field label="Reason" htmlFor="inv-reason" required className="lg:col-span-2" error={attempted ? errors.reason : undefined}>
              <Input
                id="inv-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Charged for 400 units instead of 300"
              />
            </Field>
          </>
        )}
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
            {/* Finding #165 — per-line GL/VAT/discount, informational
                alongside the header-level VAT Treatment above (which
                still drives the actual posted total — see
                NewSalesInvoiceLine's own comment). */}
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
            {/* Phase 5I — per-line problems, named against the line they
                belong to rather than as one message at the bottom. */}
            {attempted && errors.lines?.[i] && (
              <p role="alert" className="w-full text-xs text-vf-danger">
                Line {i + 1}: {[errors.lines[i]!.description, errors.lines[i]!.quantity, errors.lines[i]!.unitPrice, errors.lines[i]!.discount].filter(Boolean).join(" ")}
              </p>
            )}
          </div>
        ))}
        <Button variant="subtle" size="sm" className="w-fit" onClick={() => setLines((prev) => [...prev, { ...BLANK_LINE }])}>
          <IconPlus className="h-4 w-4" /> Add Line
        </Button>
      </div>

      {/* Phase 5J — the real breakdown, and it is trustworthy now.
          Phase 5I could only state the sum of quantity x unit price,
          because the per-line VAT codes and discounts fed nothing; it said
          so rather than inventing a VAT line. They feed the totals now, so
          the figures below are the ones that will be saved — computed by
          the same module the server uses, against the same VAT rates. The
          server still recomputes and stores its own result; this is a
          preview, never an input. */}
      <div className="mt-3 flex justify-end">
        <dl className="w-72 space-y-1 text-sm">
          {totals.discountTotal > 0 && (
            <>
              <div className="flex justify-between text-vf-ink-soft">
                <dt>Lines before discount</dt>
                <dd className="font-mono tabular-nums">{money(Math.round((totals.subtotal + totals.discountTotal) * 100) / 100)}</dd>
              </div>
              <div className="flex justify-between text-vf-ink-soft">
                <dt>Discount</dt>
                <dd className="font-mono tabular-nums">−{money(totals.discountTotal)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between text-vf-ink-soft">
            <dt>Subtotal (excl. VAT)</dt>
            <dd className="font-mono tabular-nums">{money(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between text-vf-ink-soft">
            <dt>VAT</dt>
            <dd className="font-mono tabular-nums">{money(totals.vatAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-vf-ink/20 pt-1 text-base font-semibold text-vf-ink">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums">{money(totals.total)}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-1 text-right text-xs text-vf-ink-faint">
        {preview.ok
          ? <>A line with no VAT code uses the {documentType === "Invoice" ? "invoice" : "document"}&rsquo;s VAT Treatment. The server recalculates these figures on saving.</>
          : <>One line uses a VAT code this company does not have — saving will say which.</>}
      </p>

      <div className="mt-3 flex gap-2">
        {/* Phase 5I — `!customerId` keeps Save unreachable until a
            customer is chosen on purpose; there is no default any more. */}
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

/** A Draft whose lines arrived without an account (e.g. an import file
 * with a blank AccountCode): assign one Income account to those lines
 * only. Lines that already have an account, and every amount, are left
 * as they are — see `assignMissingLineAccounts`. A Posted invoice gets
 * the same control limited to account 1000, which changes no journal —
 * see `assignMissingPostedLineAccounts`. */
export function AssignLineAccounts({
  companyId,
  invoice,
  chartOfAccounts,
  previewMode,
  onDone,
}: {
  companyId: string;
  invoice: SalesInvoice;
  chartOfAccounts: ChartOfAccount[];
  previewMode: boolean;
  onDone: () => void;
}) {
  const posted = invoice.status === "Posted" && invoice.documentType === "Invoice";
  const income = chartOfAccounts.filter((a) => a.isActive && a.accountType === "Income" && (!posted || a.accountCode === "1000"));
  const missing = invoice.lines.filter((l) => !l.glAccount).length;
  const [glAccount, setGlAccount] = useState(income.find((a) => a.accountCode === "1000")?.accountCode ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if ((invoice.status !== "Draft" && !posted) || missing === 0) return null;

  async function assign() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/sales/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: posted ? "assign-posted-line-accounts" : "assign-line-accounts", glAccount }),
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
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-vf-danger">
        {missing} line(s) have no revenue account.{posted && " Assigning one changes no journal, amount or VAT."}
      </span>
      <div className="w-56">
        <Select aria-label="Revenue account for lines without one" value={glAccount} onChange={(e) => setGlAccount(e.target.value)}>
          <option value="">Choose an Income account…</option>
          {income.map((a) => (
            <option key={a.accountCode} value={a.accountCode}>{a.accountCode} — {a.description}</option>
          ))}
        </Select>
      </div>
      <Button variant="subtle" size="sm" disabled={previewMode || loading || !glAccount} onClick={assign}>
        Assign to lines without an account
      </Button>
      {error && <span className="text-vf-danger">{error}</span>}
    </div>
  );
}

export function InvoicesTab({
  companyId,
  invoices,
  customers,
  vatTreatments,
  chartOfAccounts,
  previewMode,
}: {
  companyId: string;
  invoices: SalesInvoice[];
  customers: Customer[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
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
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null);
  const viewedInvoice = invoices.find((i) => i.id === viewInvoiceId) ?? null;
  const [repairSelection, setRepairSelection] = useState<Set<number>>(new Set());
  // The selection column exists only while some Posted invoice still has a line without an account.
  const repairColumn = invoices.some(isPostedRepairCandidate);

  const base = `/api/companies/${companyId}/sales/invoices`;
  // Phase 5I — the button was already disabled when a company had no
  // customers or no VAT treatments, but said so only in preview mode. The
  // other two cases greyed it out and gave no reason at all.
  const disabledTitle = previewMode
    ? "Available once a production Supabase project is connected"
    : customers.length === 0
      ? "Add a customer first — a sales document has to name the party being billed"
      : vatTreatments.length === 0
        ? "Set up a VAT treatment first — a sales document has to state how VAT applies"
        : undefined;
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
        <InvoiceFormPanel companyId={companyId} customers={customers} vatTreatments={vatTreatments} chartOfAccounts={chartOfAccounts} invoices={invoices} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />
      )}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      <PostedLineAccountsBulkRepair
        companyId={companyId}
        invoices={invoices}
        visibleInvoices={filtered}
        selected={repairSelection}
        onSelectedChange={setRepairSelection}
        previewMode={previewMode}
        onDone={() => router.refresh()}
      />

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileText className="h-5 w-5" />} title="No sales documents." description="No invoices, credit notes, or debit notes match the current filters." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              {repairColumn && <TableHeadCell><span className="sr-only">Select for account repair</span></TableHeadCell>}
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
                    {repairColumn && (
                      <TableCell>
                        {isPostedRepairCandidate(i) && (
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            aria-label={`Select ${i.invoiceNumber} for account repair`}
                            checked={repairSelection.has(i.id)}
                            onChange={(e) => {
                              const next = new Set(repairSelection);
                              if (e.target.checked) next.add(i.id);
                              else next.delete(i.id);
                              setRepairSelection(next);
                            }}
                          />
                        )}
                      </TableCell>
                    )}
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
                        <Button variant="subtle" size="sm" onClick={() => setViewInvoiceId(i.id)}>
                          View
                        </Button>
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
                      <TableCell colSpan={repairColumn ? 11 : 10} className="bg-vf-paper-alt/40">
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
                            <AssignLineAccounts companyId={companyId} invoice={i} chartOfAccounts={chartOfAccounts} previewMode={previewMode} onDone={() => router.refresh()} />
                          </div>
                          <div className="text-xs text-vf-ink-faint">
                            <p className="mb-1.5 font-medium uppercase tracking-wide">History</p>
                            {i.submittedAt && <p>Submitted {i.submittedBy ? `by ${i.submittedBy} ` : ""}— {formatDateTime(i.submittedAt)}</p>}
                            {i.approvedAt && <p>Approved {i.approvedBy ? `by ${i.approvedBy} ` : ""}— {formatDateTime(i.approvedAt)}</p>}
                            {i.postedAt && <p>Posted — {formatDateTime(i.postedAt)}</p>}
                            {i.cancelledAt && <p>Cancelled {i.cancelledBy ? `by ${i.cancelledBy} ` : ""}— {formatDateTime(i.cancelledAt)}</p>}
                            {i.journalId !== null && <p className="mt-1">Journal #{i.journalId}</p>}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-col gap-3">
                          <CommunicationHistoryPanel companyId={companyId} businessObjectType="SalesInvoice" businessObjectId={i.id} previewMode={previewMode} />
                          <DocumentsPanel companyId={companyId} entityType="SalesInvoice" entityId={i.id} previewMode={previewMode} />
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

      {viewedInvoice && (
        <InvoiceDocument
          companyId={companyId}
          invoice={viewedInvoice}
          customer={customers.find((c) => c.id === viewedInvoice.customerId)}
          open={viewInvoiceId !== null}
          onClose={() => setViewInvoiceId(null)}
          previewMode={previewMode}
          // Phase 5J — resolved from the list this tab already holds, so
          // the preview carries the same s21(3) particulars the PDF does,
          // without a second fetch.
          originalInvoice={invoices.find((i) => i.id === viewedInvoice.originalInvoiceId) ?? null}
        />
      )}
    </div>
  );
}
