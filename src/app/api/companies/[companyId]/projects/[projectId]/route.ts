import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { NotFoundError, setProjectActive, updateProject, ValidationError } from "@/server/services/org-master-data-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, projectId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  try {
    if (typeof body.isActive === "boolean" && body.name === undefined && body.code === undefined) {
      const project = await setProjectActive(companyId, Number(projectId), body.isActive);
      return NextResponse.json({ project });
    }
    const performedBy = await getPerformedByLabel();
    const project = await updateProject(companyId, Number(projectId), { name: body.name, code: body.code }, performedBy, body.reason);
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
