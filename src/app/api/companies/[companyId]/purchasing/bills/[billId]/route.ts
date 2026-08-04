import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveAndPostBill,
  cancelBill,
  getPurchaseBill,
  NotFoundError,
  retryPostBill,
  submitBill,
  ValidationError,
} from "@/server/services/purchase-bill-service";
import { requireApproval, requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; billId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, billId } = await params;
  const bill = await getPurchaseBill(companyId, Number(billId));
  if (!bill) return NextResponse.json({ error: "Bill not found." }, { status: 404 });
  return NextResponse.json({ bill });
}

/** `approve` performs the real, automatic Approve -> Posting Rule ->
 * Journal -> Posting Engine chain in one request — see
 * `purchase-bill-service.ts::approveAndPostBill`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; billId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, billId } = await params;
  const id = Number(billId);
  const body = await request.json();

  try {
    switch (body.action) {
      case "submit": {
        const submitCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!submitCheck.ok) return submitCheck.response;
        const bill = await submitBill(companyId, id);
        return NextResponse.json({ bill });
      }
      case "approve": {
        const existing = await getPurchaseBill(companyId, id);
        if (!existing) return NextResponse.json({ error: `No bill with id ${id}.` }, { status: 404 });
        const approvalCheck = await requireApproval(companyId, "ApprovePurchases", "PurchaseApproval", existing.total);
        if (!approvalCheck.ok) return approvalCheck.response;
        const bill = await approveAndPostBill(companyId, id);
        return NextResponse.json({ bill });
      }
      case "retry-post": {
        const retryCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!retryCheck.ok) return retryCheck.response;
        const bill = await retryPostBill(companyId, id);
        return NextResponse.json({ bill });
      }
      case "cancel": {
        const cancelCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!cancelCheck.ok) return cancelCheck.response;
        const bill = await cancelBill(companyId, id);
        return NextResponse.json({ bill });
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
