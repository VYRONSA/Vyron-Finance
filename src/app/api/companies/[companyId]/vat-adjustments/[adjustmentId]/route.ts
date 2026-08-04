import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { approveAndPostAdjustment, NotFoundError, ValidationError } from "@/server/services/vat-adjustment-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; adjustmentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, adjustmentId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  try {
    if (body.action !== "approve") {
      return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
    const vatAdjustment = await approveAndPostAdjustment(companyId, Number(adjustmentId), performedBy);
    return NextResponse.json({ vatAdjustment });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
