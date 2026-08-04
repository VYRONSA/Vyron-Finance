import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { updateVatTreatment, ValidationError } from "@/server/services/vat-treatment-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string; vatTreatmentId: string }> },
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, vatTreatmentId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  try {
    const vatTreatment = await updateVatTreatment(companyId, Number(vatTreatmentId), body, performedBy);
    return NextResponse.json({ vatTreatment });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
