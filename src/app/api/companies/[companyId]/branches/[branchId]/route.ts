import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { setBranchActive } from "@/server/services/org-master-data-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; branchId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, branchId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  const branch = await setBranchActive(companyId, Number(branchId), body.isActive);
  return NextResponse.json({ branch });
}
