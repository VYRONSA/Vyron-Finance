import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveAndPostReceipt,
  cancelReceipt,
  getCustomerReceipt,
  NotFoundError,
  retryPostReceipt,
  ValidationError,
} from "@/server/services/customer-receipt-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; receiptId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, receiptId } = await params;
  const receipt = await getCustomerReceipt(companyId, Number(receiptId));
  if (!receipt) return NextResponse.json({ error: "Customer receipt not found." }, { status: 404 });
  return NextResponse.json({ receipt });
}

/** `approve` performs the real, automatic Approve -> Posting Rule ->
 * Journal -> Posting Engine chain in one request — see
 * `customer-receipt-service.ts::approveAndPostReceipt`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; receiptId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, receiptId } = await params;
  const id = Number(receiptId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "approve": {
        const receipt = await approveAndPostReceipt(companyId, id);
        return NextResponse.json({ receipt });
      }
      case "retry-post": {
        const receipt = await retryPostReceipt(companyId, id);
        return NextResponse.json({ receipt });
      }
      case "cancel": {
        const receipt = await cancelReceipt(companyId, id);
        return NextResponse.json({ receipt });
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
