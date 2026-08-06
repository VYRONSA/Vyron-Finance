import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveOrder,
  cancelOrder,
  getPurchaseOrder,
  NotFoundError,
  rejectOrder,
  submitOrder,
  updateOrderLines,
  ValidationError,
} from "@/server/services/purchase-order-service";
import { requireApproval, requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; orderId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, orderId } = await params;
  const order = await getPurchaseOrder(companyId, Number(orderId));
  if (!order) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
  return NextResponse.json({ order });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; orderId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, orderId } = await params;
  const id = Number(orderId);
  const body = await request.json();

  try {
    switch (body.action) {
      case "submit": {
        const submitCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!submitCheck.ok) return submitCheck.response;
        const order = await submitOrder(companyId, id);
        return NextResponse.json({ order });
      }
      case "approve": {
        const existing = await getPurchaseOrder(companyId, id);
        if (!existing) return NextResponse.json({ error: `No purchase order with id ${id}.` }, { status: 404 });
        const amount = existing.lines.reduce((sum, l) => sum + l.lineTotal, 0);
        const approvalCheck = await requireApproval(companyId, "ApprovePurchases", "PurchaseApproval", amount);
        if (!approvalCheck.ok) return approvalCheck.response;
        const order = await approveOrder(companyId, id);
        return NextResponse.json({ order });
      }
      case "reject": {
        const rejectCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!rejectCheck.ok) return rejectCheck.response;
        const order = await rejectOrder(companyId, id);
        return NextResponse.json({ order });
      }
      case "cancel": {
        const cancelCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!cancelCheck.ok) return cancelCheck.response;
        const order = await cancelOrder(companyId, id);
        return NextResponse.json({ order });
      }
      case "update-lines": {
        const editCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!editCheck.ok) return editCheck.response;
        const order = await updateOrderLines(companyId, id, body.lines ?? []);
        return NextResponse.json({ order });
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
