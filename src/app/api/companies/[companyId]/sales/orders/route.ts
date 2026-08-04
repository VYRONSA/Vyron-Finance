import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createOrderFromQuotation, createSalesOrder, listSalesOrders, NotFoundError, ValidationError } from "@/server/services/sales-order-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const orders = await listSalesOrders(companyId);
  return NextResponse.json({ orders });
}

/** Either a direct order (`customerId`/`orderDate`/`lines`) or a real
 * Quotation -> Order conversion (`quotationId`/`orderDate`, no lines —
 * the service copies the quotation's own lines). */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  try {
    if (body.quotationId) {
      const order = await createOrderFromQuotation(companyId, Number(body.quotationId), body.orderDate);
      return NextResponse.json({ order }, { status: 201 });
    }
    const order = await createSalesOrder(companyId, body);
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
