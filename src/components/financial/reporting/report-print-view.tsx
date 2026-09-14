"use client";

import { useRouter } from "next/navigation";
import { DocumentPreviewOverlay } from "@/components/documents/document-preview-overlay";
import type { ReportResult } from "@/server/report-centre/types";
import type { Letterhead } from "@/server/report-centre/letterhead";
import { ReportDocument } from "./report-document";
import type { ReportHomeMap } from "./drill-href";

/** A report's print/PDF view: the shared document overlay (the same
 * Print / Download PDF / Close chrome and print isolation every VYRON
 * document uses) around the report document. Puppeteer renders this
 * same page for Download PDF. */
export function ReportPrintView({
  companyId,
  result,
  letterhead,
  reportHome,
  downloadHref,
  backHref,
  message,
}: {
  companyId: string;
  result: ReportResult | null;
  letterhead: Letterhead;
  reportHome: ReportHomeMap;
  downloadHref: string;
  backHref: string;
  message: string | null;
}) {
  const router = useRouter();
  return (
    <DocumentPreviewOverlay title={result?.title ?? "Report"} onClose={() => router.push(backHref)} downloadHref={result ? downloadHref : undefined}>
      {result ? <ReportDocument result={result} letterhead={letterhead} companyId={companyId} reportHome={reportHome} /> : <p className="p-10 text-sm text-vf-ink-soft">{message}</p>}
    </DocumentPreviewOverlay>
  );
}
