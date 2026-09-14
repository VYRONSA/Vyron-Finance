"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DocumentPreviewOverlay } from "@/components/documents/document-preview-overlay";
import { SendDocumentEmailAction } from "@/components/documents/send-document-email-action";
import { useCustomerPrimaryEmail } from "@/components/documents/use-customer-primary-email";
import { BusinessDocumentBody } from "@/components/documents/print/business-document-body";
import type { BusinessDocument } from "@/server/report-centre/documents";
import type { Letterhead } from "@/server/report-centre/letterhead";
import { invoicePdfFilename } from "@/server/pdf/pdf-filename";
import { drillHref, type ReportHomeMap } from "./drill-href";

/**
 * Document Centre — any customer or supplier document, re-opened for
 * viewing, printing and downloading, with its trail through the books
 * (journal, settlements, bank transactions, related documents) in the
 * non-printing header. Sales invoices keep their existing PDF and email
 * actions; every other document uses the Document Centre PDF. The
 * document itself is `BusinessDocumentBody` — the same body the
 * server-rendered PDF uses.
 */
export function BusinessDocumentView({
  companyId,
  document: doc,
  letterhead,
  reportHome,
  backHref,
  previewMode,
}: {
  companyId: string;
  document: BusinessDocument;
  letterhead: Letterhead;
  reportHome: ReportHomeMap;
  backHref: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const recipientEmail = useCustomerPrimaryEmail(companyId, doc.salesInvoiceId !== null && doc.party.id !== null ? doc.party.id : null);
  const downloadHref =
    doc.salesInvoiceId !== null ? `/api/companies/${companyId}/sales/invoices/${doc.salesInvoiceId}/pdf` : `/api/companies/${companyId}/reporting/documents/${doc.docType}/${doc.id}/pdf`;

  const trail = (
    <div className="flex flex-col gap-3">
      {doc.salesInvoiceId !== null && (
        <SendDocumentEmailAction
          sendUrl={`/api/companies/${companyId}/sales/invoices/${doc.salesInvoiceId}/send-email`}
          recipientEmail={recipientEmail}
          documentLabel={`${doc.title} ${doc.number}`}
          attachmentFilename={invoicePdfFilename({ invoiceNumber: doc.number } as Parameters<typeof invoicePdfFilename>[0])}
          companyName={letterhead.name}
          previewMode={previewMode}
        />
      )}
      {doc.trace.length > 0 && (
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-vf-ink-faint">Trace through the books</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {doc.trace.map((t, i) => (
              <li key={i}>
                <Link href={drillHref(companyId, reportHome, t.drill)} className="inline-flex items-center gap-1.5 rounded-full border border-vf-paper-border px-3 py-1 text-xs text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600">
                  <span className="font-semibold text-vf-ink">{t.label}</span>
                  <span>{t.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <DocumentPreviewOverlay title={`${doc.title} ${doc.number}`} onClose={() => router.push(backHref)} downloadHref={downloadHref} headerExtra={trail}>
      <BusinessDocumentBody document={doc} letterhead={letterhead} />
    </DocumentPreviewOverlay>
  );
}
