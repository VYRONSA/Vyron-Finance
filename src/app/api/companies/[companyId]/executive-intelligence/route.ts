import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const financialYearStartDate = url.searchParams.get("financialYearStartDate");
  if (!dateFrom || !dateTo || !financialYearStartDate) {
    return NextResponse.json({ error: "dateFrom, dateTo, and financialYearStartDate are required." }, { status: 400 });
  }

  const executiveIntelligence = await getExecutiveIntelligence(companyId, dateFrom, dateTo, financialYearStartDate);
  return NextResponse.json({ executiveIntelligence });
}
