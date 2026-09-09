import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { deleteAuditQuery } from "@/server/services/audit-query-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; queryId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, queryId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  await deleteAuditQuery(companyId, Number(queryId));
  return NextResponse.json({ ok: true });
}
