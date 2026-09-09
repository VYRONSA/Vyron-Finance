import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { NotFoundError, setBranchActive, updateBranch, ValidationError } from "@/server/services/org-master-data-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; branchId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, branchId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  try {
    if (typeof body.isActive === "boolean" && body.name === undefined && body.code === undefined && body.address === undefined) {
      const branch = await setBranchActive(companyId, Number(branchId), body.isActive);
      return NextResponse.json({ branch });
    }
    const performedBy = await getPerformedByLabel();
    const branch = await updateBranch(companyId, Number(branchId), { name: body.name, code: body.code, address: body.address }, performedBy, body.reason);
    return NextResponse.json({ branch });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
