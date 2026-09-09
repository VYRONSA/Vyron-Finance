import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listCopilotScenarios, runScenario, ValidationError } from "@/server/services/scenario-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const scenarios = await listCopilotScenarios(companyId);
  return NextResponse.json({ scenarios });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const { name, scenarioType, parameters, periodStart, periodEnd } = body;

  if (!periodStart || !periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required." }, { status: 400 });

  try {
    const scenario = await runScenario(companyId, performedBy, name, scenarioType, parameters ?? {}, periodStart, periodEnd);
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
