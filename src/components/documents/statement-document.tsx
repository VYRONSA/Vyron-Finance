"use client";

import { DocumentPreviewOverlay } from "./document-preview-overlay";
import { DocumentBrandingHeader } from "./document-branding-header";
import { useCustomerAddress } from "./use-customer-address";
import { useCustomerPrimaryEmail } from "./use-customer-primary-email";
import { useCompanyName } from "./use-company-name";
import { SendDocumentEmailAction } from "./send-document-email-action";
import { StatementDocumentBody, type StatementCustomer } from "./print/statement-body";
import { formatCustomerAddress } from "./print/customer-address";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";
import { statementPdfFilename } from "@/server/pdf/pdf-filename";

export type { StatementCustomer } from "./print/statement-body";

/** Phase 20C — the printable Customer Statement in the in-app preview:
 * the shared document overlay (Print / Download PDF / Send Email / Close)
 * around `StatementDocumentBody` — the same body the server-rendered PDF
 * uses. `entries` is the EXACT output of `buildCustomerStatement`; this
 * component performs no calculation of its own. */
export function StatementDocument({
  companyId,
  customer,
  entries,
  open,
  onClose,
  previewMode,
}: {
  companyId: string;
  customer: StatementCustomer;
  entries: StatementEntry[];
  open: boolean;
  onClose: () => void;
  /** Phase 24B — see `InvoiceDocument`'s own docs. */
  previewMode?: boolean;
}) {
  const address = useCustomerAddress(companyId, open ? customer.id : null);
  const recipientEmail = useCustomerPrimaryEmail(companyId, open ? customer.id : null);
  const companyName = useCompanyName(companyId);

  if (!open) return null;

  const statementDate = new Date().toISOString().slice(0, 10);

  return (
    <DocumentPreviewOverlay
      title={`Statement — ${customer.name}`}
      onClose={onClose}
      headerExtra={
        <SendDocumentEmailAction
          sendUrl={`/api/companies/${companyId}/customers/${customer.id}/statement/send-email`}
          recipientEmail={recipientEmail}
          documentLabel={`Statement — ${customer.name}`}
          attachmentFilename={statementPdfFilename(customer.name, statementDate)}
          companyName={companyName ?? ""}
          previewMode={previewMode ?? false}
        />
      }
      downloadHref={`/api/companies/${companyId}/customers/${customer.id}/statement/pdf`}
    >
      <StatementDocumentBody
        customer={customer}
        entries={entries}
        addressLine={formatCustomerAddress(address)}
        statementDate={statementDate}
        letterhead={<DocumentBrandingHeader companyId={companyId} />}
      />
    </DocumentPreviewOverlay>
  );
}
