import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { resolveException, NotFoundError, ValidationError } from "@/server/services/banking-exception-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; exceptionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, exceptionId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    if (body.status !== "Resolved" && body.status !== "Dismissed") {
      return NextResponse.json({ error: "status must be 'Resolved' or 'Dismissed'." }, { status: 400 });
    }
    const exception = await resolveException(companyId, Number(exceptionId), body.status, performedBy, body.note ?? "");
    return NextResponse.json({ exception });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
