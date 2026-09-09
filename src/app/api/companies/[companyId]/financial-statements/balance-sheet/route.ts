import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getBalanceSheet } from "@/server/services/financial-statements-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const asOfDate = url.searchParams.get("asOfDate");
  const financialYearStartDate = url.searchParams.get("financialYearStartDate");
  if (!asOfDate || !financialYearStartDate) return NextResponse.json({ error: "asOfDate and financialYearStartDate are required." }, { status: 400 });

  const balanceSheet = await getBalanceSheet(companyId, asOfDate, financialYearStartDate);
  return NextResponse.json({ balanceSheet });
}
