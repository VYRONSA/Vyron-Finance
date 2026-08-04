import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { buildDashboardCounts } from "@/server/accounting/reconciliation-reports";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const counts = await buildDashboardCounts(companyId);
  return NextResponse.json(counts);
}
