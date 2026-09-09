import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { deleteReportDefinition, getReportDefinition } from "@/server/services/report-definition-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; reportDefinitionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reportDefinitionId } = await params;
  const reportDefinition = await getReportDefinition(companyId, Number(reportDefinitionId));
  if (!reportDefinition) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ reportDefinition });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; reportDefinitionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reportDefinitionId } = await params;

  const check = await requirePermission(companyId, "Reports:Edit");
  if (!check.ok) return check.response;

  await deleteReportDefinition(companyId, Number(reportDefinitionId));
  return NextResponse.json({ ok: true });
}
