import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { cancelOrder, confirmOrder, getSalesOrder, NotFoundError, ValidationError } from "@/server/services/sales-order-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; orderId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, orderId } = await params;
  const order = await getSalesOrder(companyId, Number(orderId));
  if (!order) return NextResponse.json({ error: "Sales order not found." }, { status: 404 });
  return NextResponse.json({ order });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; orderId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, orderId } = await params;
  const id = Number(orderId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "confirm": {
        const order = await confirmOrder(companyId, id);
        return NextResponse.json({ order });
      }
      case "cancel": {
        const order = await cancelOrder(companyId, id);
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
