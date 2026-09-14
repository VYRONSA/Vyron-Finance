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
}: {
  invoice: SalesInvoice;
  customer: Pick<Customer, "name" | "vatNumber" | "registrationNumber"> | undefined;
  addressLine: string | null;
  letterhead: ReactNode;
}) {
  const title = INVOICE_DOCUMENT_TITLE[invoice.documentType];
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

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-vf-ink/20 text-left text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
            <th className="pb-2 pr-2">Description</th>
            <th className="pb-2 px-2 text-right">Qty</th>
            <th className="pb-2 px-2 text-right">Unit Price</th>
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
              <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{line.vatAmount > 0 ? formatAmount(line.vatAmount) : "—"}</td>
              <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-vf-ink">{formatAmount(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end">
        <dl className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between text-vf-ink-soft">
            <dt>Subtotal</dt>
            <dd className="font-mono tabular-nums">{formatAmount(invoice.subtotal)}</dd>
          </div>
          <div className="flex justify-between text-vf-ink-soft">
            <dt>VAT</dt>
            <dd className="font-mono tabular-nums">{formatAmount(invoice.vatAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-vf-ink/20 pt-1.5 text-base font-semibold text-vf-ink">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums">{formatAmount(invoice.total)}</dd>
          </div>
          {invoice.outstanding > 0 && (
            <div className="flex justify-between text-vf-danger">
              <dt>Outstanding</dt>
              <dd className="font-mono tabular-nums font-medium">{formatAmount(invoice.outstanding)}</dd>
            </div>
          )}
        </dl>
      </div>

      {invoice.notes && <p className="text-xs text-vf-ink-faint">{invoice.notes}</p>}
    </div>
  );
}
