import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import {
  approveVatReturn,
  createAmendment,
  getVatReturn,
  moveToReview,
  NotFoundError,
  recalculateVatReturn,
  submitVatReturn,
  updateVatReturnNotes,
  ValidationError,
} from "@/server/services/vat-return-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; vatReturnId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, vatReturnId } = await params;
  const vatReturn = await getVatReturn(companyId, Number(vatReturnId));
  if (!vatReturn) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ vatReturn });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; vatReturnId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, vatReturnId } = await params;
  const id = Number(vatReturnId);
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "recalculate": {
        const vatReturn = await recalculateVatReturn(companyId, id, performedBy);
        return NextResponse.json({ vatReturn });
      }
      case "review": {
        const vatReturn = await moveToReview(companyId, id, performedBy);
        return NextResponse.json({ vatReturn });
      }
      case "approve": {
        const vatReturn = await approveVatReturn(companyId, id, performedBy);
        return NextResponse.json({ vatReturn });
      }
      case "submit": {
        const vatReturn = await submitVatReturn(companyId, id, performedBy, body.sarsReference);
        return NextResponse.json({ vatReturn });
      }
      case "amend": {
        const vatReturn = await createAmendment(companyId, id, performedBy);
        return NextResponse.json({ vatReturn }, { status: 201 });
      }
      case "notes": {
        const vatReturn = await updateVatReturnNotes(companyId, id, body.notes ?? "");
        return NextResponse.json({ vatReturn });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
