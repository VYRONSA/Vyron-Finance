import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createOrderFromRequisition, createPurchaseOrder, listPurchaseOrders, NotFoundError, ValidationError } from "@/server/services/purchase-order-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const orders = await listPurchaseOrders(companyId);
  return NextResponse.json({ orders });
}

/** Either a direct order (`supplierId`/`orderDate`/`lines`) or a real
 * Requisition -> Order conversion (`requisitionId`/`supplierId`/
 * `orderDate`, no lines — the service copies the requisition's own
 * lines). */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  try {
    if (body.requisitionId) {
      const order = await createOrderFromRequisition(companyId, Number(body.requisitionId), Number(body.supplierId), body.orderDate);
      return NextResponse.json({ order }, { status: 201 });
    }
    const order = await createPurchaseOrder(companyId, body);
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
