import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { allocateReceipt, NotFoundError, ValidationError } from "@/server/services/customer-receipt-service";
import { requirePermission } from "@/server/services/permission-service";

/** Real Customer Allocations — records which invoice(s) a Posted receipt
 * paid off. Never generates its own journal; see
 * `customer-receipt-service.ts::allocateReceipt`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; receiptId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, receiptId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Edit");
  if (!check.ok) return check.response;

  try {
    await allocateReceipt(companyId, Number(receiptId), Number(body.invoiceId), Number(body.amount));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
