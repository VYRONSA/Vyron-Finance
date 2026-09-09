import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { generateNarrative, listCopilotNarratives } from "@/server/services/narrative-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const narratives = await listCopilotNarratives(companyId);
  return NextResponse.json({ narratives });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const { narrativeType, periodStart, periodEnd, financialYearStartDate, financialYearLabel } = body;

  if (!narrativeType || !periodStart || !periodEnd || !financialYearStartDate || !financialYearLabel) {
    return NextResponse.json({ error: "narrativeType, periodStart, periodEnd, financialYearStartDate, and financialYearLabel are required." }, { status: 400 });
  }

  const narrative = await generateNarrative(companyId, narrativeType, periodStart, periodEnd, financialYearStartDate, financialYearLabel, performedBy);
  return NextResponse.json({ narrative }, { status: 201 });
}
