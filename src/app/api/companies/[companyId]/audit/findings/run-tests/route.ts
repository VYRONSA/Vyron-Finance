import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { runAuditTests } from "@/server/services/audit-test-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const { engagementId, periodStart, periodEnd, materialityThreshold, holidayDates } = body;

  if (!periodStart || !periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required." }, { status: 400 });

  const result = await runAuditTests(companyId, engagementId ?? null, periodStart, periodEnd, materialityThreshold ?? 50000, holidayDates ?? []);
  return NextResponse.json(result);
}
