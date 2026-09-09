import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { runAuditIntelligence } from "@/server/services/audit-intelligence-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const { engagementId, periodStart, periodEnd, financialYearStartDate } = body;

  if (!periodStart || !periodEnd || !financialYearStartDate) {
    return NextResponse.json({ error: "periodStart, periodEnd, and financialYearStartDate are required." }, { status: 400 });
  }

  const result = await runAuditIntelligence(companyId, engagementId ?? null, periodStart, periodEnd, financialYearStartDate);
  return NextResponse.json(result);
}
