"use client";

import { DocumentPreviewOverlay } from "./document-preview-overlay";
import { DocumentBrandingHeader } from "./document-branding-header";
import { useCustomerAddress } from "./use-customer-address";
import { useCustomerPrimaryEmail } from "./use-customer-primary-email";
import { useCompanyName } from "./use-company-name";
import { SendDocumentEmailAction } from "./send-document-email-action";
import { INVOICE_DOCUMENT_TITLE, InvoiceDocumentBody } from "./print/invoice-body";
import { formatCustomerAddress } from "./print/customer-address";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";
import { invoicePdfFilename } from "@/server/pdf/pdf-filename";

/** Phase 20C — the printable Sales Invoice in the in-app preview: the
 * shared document overlay (Print / Download PDF / Send Email / Close)
 * around `InvoiceDocumentBody` — the same body the server-rendered PDF
 * uses, so the PDF is exactly what the accountant sees here. Company
 * branding comes from the shared `DocumentBrandingHeader`. Accounting
 * figures are read directly from the already-computed `SalesInvoice` —
 * this component performs no calculation of its own. */
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

  const label = `${INVOICE_DOCUMENT_TITLE[invoice.documentType]} ${invoice.invoiceNumber}`;

  return (
    <DocumentPreviewOverlay
      title={label}
      onClose={onClose}
      downloadHref={`/api/companies/${companyId}/sales/invoices/${invoice.id}/pdf`}
      headerExtra={
        <SendDocumentEmailAction
          sendUrl={`/api/companies/${companyId}/sales/invoices/${invoice.id}/send-email`}
          recipientEmail={recipientEmail}
          documentLabel={label}
          attachmentFilename={invoicePdfFilename(invoice)}
          companyName={companyName ?? ""}
          previewMode={previewMode ?? false}
        />
      }
    >
      <InvoiceDocumentBody
        invoice={invoice}
        customer={customer}
        addressLine={formatCustomerAddress(address)}
        letterhead={<DocumentBrandingHeader companyId={companyId} />}
      />
    </DocumentPreviewOverlay>
  );
}
