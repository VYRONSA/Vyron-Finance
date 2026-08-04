import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { setAuditProgrammeStepComplete } from "@/server/services/audit-engagement-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; stepId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, stepId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const step = await setAuditProgrammeStepComplete(companyId, Number(stepId), body.isComplete);
  return NextResponse.json({ step });
}
