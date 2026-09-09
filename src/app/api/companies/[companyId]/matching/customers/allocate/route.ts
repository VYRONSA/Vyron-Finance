import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { manualAllocate } from "@/server/services/customer-matching-service";
import { ValidationError, NotFoundError } from "@/server/services/customer-receipt-service";

/** Manual Matching — the user picks the (receipt, invoice, amount)
 * themselves; delegates to the same `allocateReceipt` real allocation
 * path Manual and Auto Matching both use. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  try {
    await manualAllocate(companyId, Number(body.receiptId), Number(body.invoiceId), Number(body.amount), performedBy);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
