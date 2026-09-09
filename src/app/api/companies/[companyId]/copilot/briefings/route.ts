import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { generateExecutiveBriefing, listCopilotBriefings } from "@/server/services/executive-briefing-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const briefings = await listCopilotBriefings(companyId);
  return NextResponse.json({ briefings });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  const body = await request.json().catch(() => ({}));
  const performedBy = await getPerformedByLabel();
  const briefingDate = body.briefingDate ?? new Date().toISOString().slice(0, 10);
  const financialYearStartDate = body.financialYearStartDate ?? `${briefingDate.slice(0, 4)}-01-01`;

  const briefing = await generateExecutiveBriefing(companyId, briefingDate, financialYearStartDate, performedBy);
  return NextResponse.json({ briefing }, { status: 201 });
}
