import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { reviewFinding } from "@/server/services/audit-finding-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; findingId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, findingId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  if (body.status !== "Reviewed" && body.status !== "Dismissed") {
    return NextResponse.json({ error: "status must be 'Reviewed' or 'Dismissed'." }, { status: 400 });
  }

  const finding = await reviewFinding(companyId, Number(findingId), body.status, performedBy, body.note ?? "");
  return NextResponse.json({ finding });
}
