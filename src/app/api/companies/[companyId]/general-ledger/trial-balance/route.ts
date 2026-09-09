import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getTrialBalance } from "@/server/services/trial-balance-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const asOfDate = url.searchParams.get("asOfDate");

  const trialBalance = await getTrialBalance(companyId, asOfDate);
  return NextResponse.json({ trialBalance });
}
