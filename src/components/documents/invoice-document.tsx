"use client";

import { DocumentPreviewOverlay } from "./document-preview-overlay";
import { DocumentBrandingHeader } from "./document-branding-header";
import { useCustomerAddress } from "./use-customer-address";
import { useCustomerPrimaryEmail } from "./use-customer-primary-email";
import { useCompanyName } from "./use-company-name";
import { SendDocumentEmailAction } from "./send-document-email-action";
import { Badge } from "@/components/ui/badge";
import type { Customer } from "@/server/customer-management/types";
import type { CustomerAddress } from "@/server/customer-management/types";
import type { SalesInvoice, SalesInvoiceStatus } from "@/server/sales/types";
import { invoicePdfFilename } from "@/server/pdf/pdf-filename";

const STATUS_TONE: Record<SalesInvoiceStatus, "muted" | "info" | "good" | "danger"> = {
  Draft: "muted",
  Submitted: "info",
  Approved: "info",
  Posted: "good",
  Cancelled: "danger",
};

const DOCUMENT_TITLE: Record<SalesInvoice["documentType"], string> = {
  Invoice: "Tax Invoice",
  "Credit Note": "Credit Note",
  "Debit Note": "Debit Note",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAddress(address: CustomerAddress | null): string | null {
  if (!address) return null;
  const parts = [address.line1, address.line2, address.city, address.region, address.postalCode, address.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Phase 20C — the first real, printable Sales Invoice document. Uses
 * ONLY real `SalesInvoice`/`SalesInvoiceLine`/`Customer` fields — no
 * fabricated data. Company branding comes from the shared
 * `DocumentBrandingHeader` (which itself goes through
 * `getCompanyBrandingAssets(companyId)`), never a second lookup.
 * Accounting figures (subtotal/VAT/total/line totals) are read directly
 * from the already-computed `SalesInvoice`/`SalesInvoiceLine` — this
 * component performs no calculation of its own. */
export function InvoiceDocument({
  companyId,
  invoice,
  customer,
  open,
  onClose,
  previewMode,
}: {
  companyId: string;
  invoice: SalesInvoice;
  customer: Customer | undefined;
  open: boolean;
  onClose: () => void;
  /** Phase 24B — gates the new "Send Email" action the same way every
   * other mutating action in this app is gated in Preview Mode. Optional
   * (defaults to `false`) so any existing caller that doesn't yet know
   * about Preview Mode keeps compiling unchanged. */
  previewMode?: boolean;
}) {
  const address = useCustomerAddress(companyId, open ? invoice.customerId : null);
  const recipientEmail = useCustomerPrimaryEmail(companyId, open ? invoice.customerId : null);
  const companyName = useCompanyName(companyId);

  if (!open) return null;

  const addressLine = formatAddress(address);

  return (
    <DocumentPreviewOverlay
      title={`${DOCUMENT_TITLE[invoice.documentType]} ${invoice.invoiceNumber}`}
      onClose={onClose}
      downloadHref={`/api/companies/${companyId}/sales/invoices/${invoice.id}/pdf`}
      headerExtra={
        <SendDocumentEmailAction
          sendUrl={`/api/companies/${companyId}/sales/invoices/${invoice.id}/send-email`}
          recipientEmail={recipientEmail}
          documentLabel={`${DOCUMENT_TITLE[invoice.documentType]} ${invoice.invoiceNumber}`}
          attachmentFilename={invoicePdfFilename(invoice)}
          companyName={companyName ?? ""}
          previewMode={previewMode ?? false}
        />
      }
    >
      <div className="flex flex-col gap-8 p-8 sm:p-10">
        <DocumentBrandingHeader companyId={companyId} />

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-ink-faint">Bill To</p>
            <p className="mt-1.5 text-sm font-medium text-vf-ink">{customer?.name ?? `Customer #${invoice.customerId}`}</p>
            {addressLine && <p className="mt-0.5 max-w-[32ch] text-sm text-vf-ink-soft">{addressLine}</p>}
            {customer?.vatNumber && <p className="mt-0.5 text-xs text-vf-ink-faint">VAT No: {customer.vatNumber}</p>}
            {customer?.registrationNumber && <p className="mt-0.5 text-xs text-vf-ink-faint">Reg No: {customer.registrationNumber}</p>}
          </div>

          <div className="text-right">
            <p className="font-display text-lg font-semibold text-vf-ink">{DOCUMENT_TITLE[invoice.documentType]}</p>
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
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{money(line.unitPrice)}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{line.vatAmount > 0 ? money(line.vatAmount) : "—"}</td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-vf-ink">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <dl className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between text-vf-ink-soft">
              <dt>Subtotal</dt>
              <dd className="font-mono tabular-nums">{money(invoice.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-vf-ink-soft">
              <dt>VAT</dt>
              <dd className="font-mono tabular-nums">{money(invoice.vatAmount)}</dd>
            </div>
            <div className="flex justify-between border-t border-vf-ink/20 pt-1.5 text-base font-semibold text-vf-ink">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums">{money(invoice.total)}</dd>
            </div>
            {invoice.outstanding > 0 && (
              <div className="flex justify-between text-vf-danger">
                <dt>Outstanding</dt>
                <dd className="font-mono tabular-nums font-medium">{money(invoice.outstanding)}</dd>
              </div>
            )}
          </dl>
        </div>

        {invoice.notes && <p className="text-xs text-vf-ink-faint">{invoice.notes}</p>}
      </div>
    </DocumentPreviewOverlay>
  );
}
