import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createAuditEngagement, listAuditEngagements, ValidationError } from "@/server/services/audit-engagement-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const engagements = await listAuditEngagements(companyId);
  return NextResponse.json({ engagements });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  try {
    const engagement = await createAuditEngagement(companyId, performedBy, body);
    return NextResponse.json({ engagement }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
