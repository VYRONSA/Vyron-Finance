import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveAndPostPayment,
  cancelPayment,
  getSupplierPayment,
  NotFoundError,
  retryPostPayment,
  ValidationError,
} from "@/server/services/supplier-payment-service";
import { requireApproval, requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; paymentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, paymentId } = await params;
  const payment = await getSupplierPayment(companyId, Number(paymentId));
  if (!payment) return NextResponse.json({ error: "Supplier payment not found." }, { status: 404 });
  return NextResponse.json({ payment });
}

/** `approve` performs the real, automatic Approve -> Posting Rule ->
 * Journal -> Posting Engine chain in one request — see
 * `supplier-payment-service.ts::approveAndPostPayment`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; paymentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, paymentId } = await params;
  const id = Number(paymentId);
  const body = await request.json();

  try {
    switch (body.action) {
      case "approve": {
        const existing = await getSupplierPayment(companyId, id);
        if (!existing) return NextResponse.json({ error: `No supplier payment with id ${id}.` }, { status: 404 });
        const approvalCheck = await requireApproval(companyId, "ApprovePayments", "SupplierPayment", existing.amount);
        if (!approvalCheck.ok) return approvalCheck.response;
        const payment = await approveAndPostPayment(companyId, id);
        return NextResponse.json({ payment });
      }
      case "retry-post": {
        const retryCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!retryCheck.ok) return retryCheck.response;
        const payment = await retryPostPayment(companyId, id);
        return NextResponse.json({ payment });
      }
      case "cancel": {
        const cancelCheck = await requirePermission(companyId, "Purchasing:Edit");
        if (!cancelCheck.ok) return cancelCheck.response;
        const payment = await cancelPayment(companyId, id);
        return NextResponse.json({ payment });
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
