import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { NotFoundError, setDepartmentActive, updateDepartment, ValidationError } from "@/server/services/org-master-data-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; departmentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, departmentId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  try {
    if (typeof body.isActive === "boolean" && body.name === undefined && body.code === undefined) {
      const department = await setDepartmentActive(companyId, Number(departmentId), body.isActive);
      return NextResponse.json({ department });
    }
    const performedBy = await getPerformedByLabel();
    const department = await updateDepartment(companyId, Number(departmentId), { name: body.name, code: body.code }, performedBy, body.reason);
    return NextResponse.json({ department });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
