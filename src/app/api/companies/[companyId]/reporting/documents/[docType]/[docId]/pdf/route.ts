import { NextResponse } from "next/server";
import { authoriseReporting } from "@/server/report-centre/authorise";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { isDocumentType, loadBusinessDocument } from "@/server/report-centre/documents";
import { generateBusinessDocumentPdf, PdfGenerationError } from "@/server/pdf/pdf-generation-service";

/** Document Centre — download any customer/supplier document again as a
 * PDF, rendered from the same document body the on-screen view shows.
 * Read-only. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; docType: string; docId: string }> }) {
  const { companyId, docType, docId } = await params;
  const denied = await authoriseReporting(companyId);
  if (denied) return denied;
  if (!isDocumentType(docType)) return NextResponse.json({ error: "Unknown document type." }, { status: 404 });

  const document = await loadBusinessDocument(reportSourceForCompany(companyId), docType, Number(docId));
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  try {
    const pdf = await generateBusinessDocumentPdf(companyId, document);
    const filename = `${document.title}-${document.number}`.replace(/[^A-Za-z0-9-]+/g, "-");
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Content-Length": String(pdf.length) },
    });
  } catch (error) {
    if (error instanceof PdfGenerationError) return NextResponse.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
