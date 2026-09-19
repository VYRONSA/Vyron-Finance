import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice, SalesInvoiceStatus } from "@/server/sales/types";

const STATUS_TONE: Record<SalesInvoiceStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

/** Phase 5I — everything a document needs to tell someone how to pay it.
 * Assembled by the caller from existing data (`ae_bank_accounts` for the
 * opted-in account, `companies` for the text); this component only
 * renders what it is given. */
export type InvoicePaymentDetails = {
  bankAccount?: { bankName: string; accountName: string; accountNumber: string; branch: string } | null;
  paymentInstructions?: string;
  footer?: string;
};

export const INVOICE_DOCUMENT_TITLE: Record<SalesInvoice["documentType"], string> = {
  Invoice: "Tax Invoice",
  "Credit Note": "Credit Note",
  "Debit Note": "Debit Note",
};

/** The printable Sales Invoice itself — letterhead, Bill To, header block,
 * lines and totals. Pure markup (no hooks, no "use client"): the in-app
 * preview (`InvoiceDocument`) and the server-rendered PDF render this ONE
 * component, so the PDF is exactly what the accountant saw. Figures are
 * read from the already-computed invoice; nothing is recalculated here. */
export function InvoiceDocumentBody({
  invoice,
  customer,
  addressLine,
  letterhead,
  currencyCode,
  paymentDetails,
  originalInvoice,
}: {
  invoice: SalesInvoice;
  customer: Pick<Customer, "name" | "vatNumber" | "registrationNumber"> | undefined;
  addressLine: string | null;
  letterhead: ReactNode;
  /** Phase 5I — the company's configured currency (`companies.base_currency_code`).
   * Amounts printed bare were ambiguous on a document that leaves the
   * building. Presentation only: no amount, rate or conversion changes,
   * and an unknown/missing code simply prints as it always did. */
  currencyCode?: string;
  /** Phase 5I — how to pay this document. Present only when the company
   * has opted a bank account in (`ae_bank_accounts.show_on_documents`)
   * and/or set footer/instruction text; absent otherwise, so a company
   * that configures nothing prints exactly what it prints today. */
  paymentDetails?: InvoicePaymentDetails;
  /** Phase 5J — the invoice this credit/debit note adjusts, resolved by
   * the caller from `invoice.originalInvoiceId`. Undefined on an Invoice,
   * and on a note issued before 5J that never named one — the document
   * then says so rather than leaving a blank that reads as compliant. */
  originalInvoice?: Pick<SalesInvoice, "invoiceNumber" | "invoiceDate"> | null;
}) {
  const title = INVOICE_DOCUMENT_TITLE[invoice.documentType];
  const amount = (value: number) => (currencyCode ? `${currencyCode} ${formatAmount(value)}` : formatAmount(value));
  const anyDiscount = invoice.lines.some((line) => line.discount > 0);
  /* Phase 5J — the discount total is SUMMED FROM THE SAVED LINES, never
   * recomputed from prices. Same rule as every other figure here: this
   * component reads the accounting record, it does not do arithmetic that
   * could disagree with it. */
  const discountTotal = Math.round(invoice.lines.reduce((sum, line) => sum + line.discount, 0) * 100) / 100;
  const isAdjustmentNote = invoice.documentType !== "Invoice";
  return (
    <div className="flex flex-col gap-8 p-8 sm:p-10">
      {letterhead}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-ink-faint">Bill To</p>
          <p className="mt-1.5 text-sm font-medium text-vf-ink">{customer?.name ?? `Customer #${invoice.customerId}`}</p>
          {addressLine && <p className="mt-0.5 max-w-[32ch] text-sm text-vf-ink-soft">{addressLine}</p>}
          {customer?.vatNumber && <p className="mt-0.5 text-xs text-vf-ink-faint">VAT No: {customer.vatNumber}</p>}
          {customer?.registrationNumber && <p className="mt-0.5 text-xs text-vf-ink-faint">Reg No: {customer.registrationNumber}</p>}
        </div>

        <div className="text-right">
          <p className="font-display text-lg font-semibold text-vf-ink">{title}</p>
          <p className="mt-1.5 font-mono text-sm text-vf-ink-soft">{invoice.invoiceNumber}</p>
          <dl className="mt-3 space-y-1 text-xs text-vf-ink-faint">
            <div className="flex justify-end gap-2">
              <dt>Date:</dt>
              <dd className="font-medium text-vf-ink-soft">{invoice.invoiceDate}</dd>
            </div>
            {invoice.dueDate && (
              <div className="flex justify-end gap-2">
                <dt>Due:</dt>
                <dd className="font-medium text-vf-ink-soft">{invoice.dueDate}</dd>
              </div>
            )}
            {invoice.reference && (
              <div className="flex justify-end gap-2">
                <dt>Reference:</dt>
                <dd className="font-medium text-vf-ink-soft">{invoice.reference}</dd>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <dt>Status:</dt>
              <dd>
                <Badge tone={STATUS_TONE[invoice.status]}>{invoice.status}</Badge>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Phase 5J — the line table scrolls inside itself rather than
          widening the whole document.
          Measured at 390x844 in a real browser: the preview overflowed its
          dialog by 49px before this phase and 132px after the Discount
          column was added, which drags the letterhead, the totals and the
          payment details sideways with it. `min-w-0` is the other half:
          a flex item's automatic minimum size is its content width, so
          without it the container grows to the table's width instead of
          shrinking and the overflow rule never engages — the same VR-022
          gotcha Phase 5I fixed in `ui/table.tsx`.
          No effect on the PDF: Chromium lays that out at A4 width, where
          the table fits and nothing scrolls. */}
      <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-vf-ink/20 text-left text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
            <th className="pb-2 pr-2">Description</th>
            <th className="pb-2 px-2 text-right">Qty</th>
            <th className="pb-2 px-2 text-right">Unit Price</th>
            {/* Phase 5J — a Discount column, shown only when some line
                actually carries one, so an undiscounted document prints
                exactly the four columns it always has. A discount that
                changes what is charged has to be visible: the customer
                cannot otherwise reconcile quantity x unit price to the
                line total. */}
            {anyDiscount && <th className="pb-2 px-2 text-right">Discount</th>}
            <th className="pb-2 px-2 text-right">VAT</th>
            <th className="pb-2 pl-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-vf-paper-border">
              <td className="py-2 pr-2 text-vf-ink">{line.description}</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{line.quantity}</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{formatAmount(line.unitPrice)}</td>
              {anyDiscount && (
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{line.discount > 0 ? `−${formatAmount(line.discount)}` : "—"}</td>
              )}
              {/* Phase 5J — a zero here now means zero VAT (a zero-rated
                  or exempt line), which is a fact worth printing, not an
                  absence. Before this phase per-line VAT was never
                  computed, so every line printed "—" on every document;
                  "0.00" was indistinguishable from "not known". */}
              <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{formatAmount(line.vatAmount)}</td>
              <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-vf-ink">{formatAmount(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="flex justify-end">
        <dl className="w-64 space-y-1.5 text-sm">
          {discountTotal > 0 && (
            <div className="flex justify-between text-vf-ink-soft">
              <dt>Discount</dt>
              <dd className="font-mono tabular-nums">−{amount(discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between text-vf-ink-soft">
            <dt>Subtotal</dt>
            <dd className="font-mono tabular-nums">{amount(invoice.subtotal)}</dd>
          </div>
          <div className="flex justify-between text-vf-ink-soft">
            <dt>VAT</dt>
            <dd className="font-mono tabular-nums">{amount(invoice.vatAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-vf-ink/20 pt-1.5 text-base font-semibold text-vf-ink">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums">{amount(invoice.total)}</dd>
          </div>
          {invoice.outstanding > 0 && (
            <div className="flex justify-between text-vf-danger">
              <dt>Amount Due</dt>
              <dd className="font-mono tabular-nums font-medium">{amount(invoice.outstanding)}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Phase 5J — the particulars VAT Act s21(3) requires on a credit or
          debit note, and which this document previously could not carry.
          `originalInvoiceId` was stored from Finding #114 onward but was
          never printed, and there was no field for a reason at all.

          (a)(vii)/(b)(vii) ask for "information sufficient to identify the
          transaction to which the note refers"; SARS's own worked examples
          in VAT 404 satisfy that with the original tax invoice's number
          and date, which is what `originalInvoice` carries here.
          (a)(vi)/(b)(vi) ask for "a brief explanation of the circumstances
          giving rise to" the note — `invoice.reason`.

          Notes issued before Phase 5J genuinely hold neither. Rather than
          print a blank box that reads as compliant, the document states
          plainly that the particular is not on record — the reader can
          then see the document is deficient, which is the truth. */}
      {isAdjustmentNote && (
        <div className="rounded-vf-sm border border-vf-ink/15 p-4">
          <dl className="space-y-0.5 text-xs text-vf-ink-soft">
            <div>
              <dt className="inline font-medium">Adjusts tax invoice: </dt>
              <dd className="inline font-mono">
                {originalInvoice
                  ? `${originalInvoice.invoiceNumber} dated ${originalInvoice.invoiceDate}`
                  : "not recorded on this document"}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">Reason: </dt>
              <dd className="inline">{invoice.reason?.trim() || "not recorded on this document"}</dd>
            </div>
          </dl>
        </div>
      )}

      {invoice.notes && <p className="text-xs text-vf-ink-faint">{invoice.notes}</p>}

      {/* Phase 5I — how to pay. Only what the company explicitly opted
          in to: one bank account it ticked for documents, plus any
          payment instructions it wrote. Nothing is inferred and no
          account is printed by default. */}
      {paymentDetails?.bankAccount && (
        <div className="rounded-vf-sm border border-vf-ink/15 p-4">
          <p className="mb-1.5 text-[0.65rem] font-semibold tracking-[0.12em] text-vf-ink-soft uppercase">Payment Details</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-vf-ink-soft sm:grid-cols-4">
            {paymentDetails.bankAccount.bankName && (
              <div><dt className="inline font-medium">Bank: </dt><dd className="inline">{paymentDetails.bankAccount.bankName}</dd></div>
            )}
            {paymentDetails.bankAccount.accountName && (
              <div><dt className="inline font-medium">Account Name: </dt><dd className="inline">{paymentDetails.bankAccount.accountName}</dd></div>
            )}
            {paymentDetails.bankAccount.accountNumber && (
              <div><dt className="inline font-medium">Account No: </dt><dd className="inline font-mono">{paymentDetails.bankAccount.accountNumber}</dd></div>
            )}
            {paymentDetails.bankAccount.branch && (
              <div><dt className="inline font-medium">Branch Code: </dt><dd className="inline font-mono">{paymentDetails.bankAccount.branch}</dd></div>
            )}
            {/* The reference a customer should use is the document's own
                number — stated rather than left to be guessed. */}
            <div><dt className="inline font-medium">Reference: </dt><dd className="inline font-mono">{invoice.invoiceNumber}</dd></div>
          </dl>
          {paymentDetails.paymentInstructions && (
            <p className="mt-2 text-xs text-vf-ink-faint">{paymentDetails.paymentInstructions}</p>
          )}
        </div>
      )}

      {paymentDetails?.footer && (
        <p className="border-t border-vf-ink/10 pt-3 text-center text-[0.65rem] text-vf-ink-faint">{paymentDetails.footer}</p>
      )}
    </div>
  );
}
