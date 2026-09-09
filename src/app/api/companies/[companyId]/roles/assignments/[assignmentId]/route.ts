import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { revokeUserRole } from "@/server/services/permission-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; assignmentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assignmentId } = await params;
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  await revokeUserRole(companyId, Number(assignmentId), performedBy);
  return NextResponse.json({ ok: true });
}
