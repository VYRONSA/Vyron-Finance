import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getReportDefinition } from "@/server/services/report-definition-service";
import { runReportDefinition, ValidationError } from "@/server/services/report-run-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; reportDefinitionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reportDefinitionId } = await params;
  const definition = await getReportDefinition(companyId, Number(reportDefinitionId));
  if (!definition) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const url = new URL(request.url);
  const p = url.searchParams;
  try {
    const result = await runReportDefinition(companyId, definition, {
      asOfDate: p.get("asOfDate") ?? undefined,
      periodStart: p.get("periodStart") ?? undefined,
      periodEnd: p.get("periodEnd") ?? undefined,
      financialYearStartDate: p.get("financialYearStartDate") ?? undefined,
      financialYearLabel: p.get("financialYearLabel") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
