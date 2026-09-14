import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportPrintView } from "@/components/financial/reporting/report-print-view";
import { REPORT_BY_ID, reportHomeMap } from "@/server/report-centre/registry";
import { cleanFilters, runReport } from "@/server/report-centre/run";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { loadLetterhead } from "@/server/report-centre/letterhead";
import { ReportInputError, type ReportResult } from "@/server/report-centre/types";

type Props = { params: Promise<{ companyId: string; reportId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { reportId } = await params;
  return { title: `${REPORT_BY_ID.get(reportId)?.title ?? "Report"} — Print — VYRON FINANCE` };
}

/** A report's print / PDF view. Print prints this page; Download PDF has
 * Puppeteer render this same page (see `generateReportPdf`). */
export default async function ReportPrintPage({ params, searchParams }: Props) {
  const { companyId, reportId } = await params;
  const def = REPORT_BY_ID.get(reportId);
  if (!def) notFound();
  const filters = cleanFilters(await searchParams);
  let result: ReportResult | null = null;
  let message: string | null = null;
  let query = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  try {
    const run = await runReport(reportSourceForCompany(companyId), reportId, filters);
    result = run.result;
    query = new URLSearchParams(Object.entries(run.filters).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  } catch (error) {
    if (!(error instanceof ReportInputError)) throw error;
    message = error.message;
  }
  const home = reportHomeMap();
  return (
    <ReportPrintView
      companyId={companyId}
      result={result}
      letterhead={await loadLetterhead(companyId)}
      reportHome={home}
      downloadHref={`/api/companies/${companyId}/reporting/${reportId}/export?format=pdf&${query}`}
      backHref={`/company/${companyId}/reporting/${home[reportId]}?report=${reportId}&${query}`}
      message={message}
    />
  );
}
