import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { listVatPaymentsForReturn, NotFoundError, recordVatPayment, ValidationError } from "@/server/services/vat-payment-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; vatReturnId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, vatReturnId } = await params;
  const payments = await listVatPaymentsForReturn(companyId, Number(vatReturnId));
  return NextResponse.json({ payments });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; vatReturnId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, vatReturnId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  try {
    const payment = await recordVatPayment(
      companyId,
      Number(vatReturnId),
      {
        paymentDate: body.paymentDate,
        amount: Number(body.amount),
        bankAccountId: body.bankAccountId ?? null,
        reference: body.reference,
        notes: body.notes,
      },
      performedBy,
    );
    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
