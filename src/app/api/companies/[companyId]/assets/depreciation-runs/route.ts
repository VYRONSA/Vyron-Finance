import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { listDepreciationRuns, runDepreciation, ValidationError } from "@/server/services/depreciation-run-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const runs = await listDepreciationRuns(companyId);
  return NextResponse.json({ runs });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "RunDepreciation");
  if (!check.ok) return check.response;

  if (!body.periodStart || !body.periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required." }, { status: 400 });

  try {
    const result = await runDepreciation(companyId, body.periodStart, body.periodEnd, performedBy);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
