import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createAuditArea, listAuditAreas, ValidationError } from "@/server/services/audit-engagement-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; engagementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, engagementId } = await params;
  const areas = await listAuditAreas(companyId, Number(engagementId));
  return NextResponse.json({ areas });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; engagementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, engagementId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();

  try {
    const area = await createAuditArea(companyId, Number(engagementId), body);
    return NextResponse.json({ area }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
