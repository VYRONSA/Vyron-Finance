import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getIncomeStatement } from "@/server/services/financial-statements-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const periodStart = url.searchParams.get("periodStart");
  const periodEnd = url.searchParams.get("periodEnd");
  if (!periodStart || !periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required." }, { status: 400 });

  const incomeStatement = await getIncomeStatement(companyId, periodStart, periodEnd);
  return NextResponse.json({ incomeStatement });
}
