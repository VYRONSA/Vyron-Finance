import { NextResponse } from "next/server";
import { authoriseReporting } from "@/server/report-centre/authorise";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { filtersFromSearchParams, runReport, ReportNotFoundError } from "@/server/report-centre/run";
import { ReportInputError } from "@/server/report-centre/types";

/** Reporting Centre — run one report (read-only) and return its result
 * as JSON. Filters are the report's query-string parameters. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; reportId: string }> }) {
  const { companyId, reportId } = await params;
  const denied = await authoriseReporting(companyId);
  if (denied) return denied;

  try {
    const { result, filters } = await runReport(reportSourceForCompany(companyId), reportId, filtersFromSearchParams(new URL(request.url).searchParams));
    return NextResponse.json({ result, filters });
  } catch (error) {
    if (error instanceof ReportNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
