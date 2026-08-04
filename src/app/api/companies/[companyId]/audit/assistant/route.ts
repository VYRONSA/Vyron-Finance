import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { askAuditAssistant } from "@/server/services/audit-assistant-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const { question, periodStart, periodEnd, performanceMateriality } = body;

  if (!question || !periodStart || !periodEnd) {
    return NextResponse.json({ error: "question, periodStart, and periodEnd are required." }, { status: 400 });
  }

  const answer = await askAuditAssistant(companyId, question, periodStart, periodEnd, performanceMateriality ?? 50000);
  return NextResponse.json({ answer });
}
