import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { updateAuditEngagement } from "@/server/services/audit-engagement-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; engagementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, engagementId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const engagement = await updateAuditEngagement(companyId, Number(engagementId), body);
  return NextResponse.json({ engagement });
}
