import { NextResponse } from "next/server";
import { authoriseReporting } from "@/server/report-centre/authorise";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { filtersFromSearchParams, runReport, ReportNotFoundError } from "@/server/report-centre/run";
import { reportFilename, reportToCsv, reportToWorkbook } from "@/server/report-centre/export";
import { ReportInputError } from "@/server/report-centre/types";
import { generateReportPdf, PdfGenerationError } from "@/server/pdf/pdf-generation-service";

/** Reporting Centre — download a report as CSV, Excel or PDF, with the
 * same filters the viewer is showing. PDF is rendered by the report's
 * print view (the same page the in-app Print uses), so the file is
 * exactly the report on screen. Read-only. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; reportId: string }> }) {
  const { companyId, reportId } = await params;
  const denied = await authoriseReporting(companyId);
  if (denied) return denied;

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  const filters = filtersFromSearchParams(url.searchParams);
  const source = reportSourceForCompany(companyId);

  try {
    const { result, filters: resolved } = await runReport(source, reportId, filters);
    const company = await source.company();

    if (format === "pdf") {
      const query = new URLSearchParams(Object.entries(resolved).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")).toString();
      const pdf = await generateReportPdf(request, companyId, reportId, query);
      return new Response(new Uint8Array(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${reportFilename(result, company, "pdf")}"`, "Content-Length": String(pdf.length) },
      });
    }
    if (format === "xlsx") {
      const workbook = await reportToWorkbook(result, company);
      const buffer = await workbook.xlsx.writeBuffer();
      return new Response(new Uint8Array(buffer as ArrayBuffer), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${reportFilename(result, company, "xlsx")}"` },
      });
    }
    if (format === "csv") {
      // BOM so Excel opens accented names/currency symbols as UTF-8.
      return new Response(`﻿${reportToCsv(result, company)}`, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${reportFilename(result, company, "csv")}"` },
      });
    }
    return NextResponse.json({ error: `Unsupported format "${format}". Use csv, xlsx or pdf.` }, { status: 400 });
  } catch (error) {
    if (error instanceof ReportNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof PdfGenerationError) return NextResponse.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
