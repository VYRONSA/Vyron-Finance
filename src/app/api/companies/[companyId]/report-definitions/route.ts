import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { createReportDefinition, listReportDefinitions, ValidationError } from "@/server/services/report-definition-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const reportDefinitions = await listReportDefinitions(companyId);
  return NextResponse.json({ reportDefinitions });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Reports:Create");
  if (!check.ok) return check.response;

  try {
    const reportDefinition = await createReportDefinition(companyId, performedBy, body);
    return NextResponse.json({ reportDefinition }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
