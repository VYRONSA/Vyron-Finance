import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { BusinessDocumentView } from "@/components/financial/reporting/business-document-view";
import { reportHomeMap } from "@/server/report-centre/registry";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { isDocumentType, loadBusinessDocument } from "@/server/report-centre/documents";
import { loadLetterhead } from "@/server/report-centre/letterhead";

type Props = { params: Promise<{ companyId: string; docType: string; docId: string }> };

export const metadata: Metadata = {
  title: "Document — Document Centre — VYRON FINANCE",
};

/** Document Centre — re-open any customer/supplier document for viewing,
 * printing and downloading. Puppeteer renders this page for the PDF. */
export default async function BusinessDocumentPage({ params }: Props) {
  const { companyId, docType, docId } = await params;
  if (!isDocumentType(docType)) notFound();
  const document = await loadBusinessDocument(reportSourceForCompany(companyId), docType, Number(docId));
  if (!document) notFound();
  return (
    <BusinessDocumentView
      companyId={companyId}
      document={document}
      letterhead={await loadLetterhead(companyId)}
      reportHome={reportHomeMap()}
      backHref={`/company/${companyId}/reporting/documents?report=document-register`}
      previewMode={!isSupabaseConfigured()}
    />
  );
}
