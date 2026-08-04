import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getReportingReadiness } from "@/server/services/reporting-readiness-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const periodStart = url.searchParams.get("periodStart");
  const periodEnd = url.searchParams.get("periodEnd");
  const financialYearStartDate = url.searchParams.get("financialYearStartDate");
  if (!periodStart || !periodEnd || !financialYearStartDate) {
    return NextResponse.json({ error: "periodStart, periodEnd, and financialYearStartDate are required." }, { status: 400 });
  }

  const readiness = await getReportingReadiness(companyId, periodStart, periodEnd, financialYearStartDate);
  return NextResponse.json({ readiness });
}
