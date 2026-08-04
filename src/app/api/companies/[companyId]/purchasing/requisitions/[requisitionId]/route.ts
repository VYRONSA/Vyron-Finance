import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveRequisition,
  getPurchaseRequisition,
  NotFoundError,
  rejectRequisition,
  submitRequisition,
  ValidationError,
} from "@/server/services/purchase-requisition-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; requisitionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, requisitionId } = await params;
  const requisition = await getPurchaseRequisition(companyId, Number(requisitionId));
  if (!requisition) return NextResponse.json({ error: "Purchase requisition not found." }, { status: 404 });
  return NextResponse.json({ requisition });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; requisitionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, requisitionId } = await params;
  const id = Number(requisitionId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "submit": {
        const requisition = await submitRequisition(companyId, id);
        return NextResponse.json({ requisition });
      }
      case "approve": {
        const requisition = await approveRequisition(companyId, id);
        return NextResponse.json({ requisition });
      }
      case "reject": {
        const requisition = await rejectRequisition(companyId, id);
        return NextResponse.json({ requisition });
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
