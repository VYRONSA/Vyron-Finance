import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { toggleClearTransaction, ValidationError, NotFoundError } from "@/server/services/bank-reconciliation-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; reconciliationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reconciliationId } = await params;
  const body = await request.json();
  const { transactionId, cleared } = body;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    await toggleClearTransaction(companyId, Number(reconciliationId), Number(transactionId), Boolean(cleared));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
