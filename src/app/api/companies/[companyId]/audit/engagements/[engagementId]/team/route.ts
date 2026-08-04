import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createAuditTeamAssignment, listAuditTeamAssignments, ValidationError } from "@/server/services/audit-engagement-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; engagementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, engagementId } = await params;
  const team = await listAuditTeamAssignments(companyId, Number(engagementId));
  return NextResponse.json({ team });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; engagementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, engagementId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();

  try {
    const member = await createAuditTeamAssignment(companyId, Number(engagementId), body);
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
