import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createPurchaseRequisition, listPurchaseRequisitions, ValidationError } from "@/server/services/purchase-requisition-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const requisitions = await listPurchaseRequisitions(companyId);
  return NextResponse.json({ requisitions });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  try {
    const requisition = await createPurchaseRequisition(companyId, body);
    return NextResponse.json({ requisition }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
