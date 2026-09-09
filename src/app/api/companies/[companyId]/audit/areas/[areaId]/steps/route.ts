import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createAuditProgrammeStep, listAuditProgrammeSteps, ValidationError } from "@/server/services/audit-engagement-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; areaId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, areaId } = await params;
  const steps = await listAuditProgrammeSteps(companyId, Number(areaId));
  return NextResponse.json({ steps });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; areaId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, areaId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();

  try {
    const step = await createAuditProgrammeStep(companyId, Number(areaId), body);
    return NextResponse.json({ step }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
