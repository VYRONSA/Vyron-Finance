import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { allocatePayment, unallocatePayment, NotFoundError, ValidationError } from "@/server/services/supplier-payment-service";
import { requirePermission } from "@/server/services/permission-service";

/** Real Supplier Allocations — records which bill(s) a Posted payment
 * settled. Never generates its own journal; see
 * `supplier-payment-service.ts::allocatePayment`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; paymentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, paymentId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  try {
    await allocatePayment(companyId, Number(paymentId), Number(body.billId), Number(body.amount));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

/** Finding #031 — removes one misapplied allocation line, restoring the
 * amount onto the bill's outstanding balance. `?allocationId=` since a
 * payment can carry several allocations and this removes exactly one. */
export async function DELETE(request: Request, { params }: { params: Promise<{ companyId: string; paymentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const allocationId = new URL(request.url).searchParams.get("allocationId");
  if (!allocationId) return NextResponse.json({ error: "allocationId is required." }, { status: 400 });

  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();

  try {
    await unallocatePayment(companyId, Number(allocationId), performedBy);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
