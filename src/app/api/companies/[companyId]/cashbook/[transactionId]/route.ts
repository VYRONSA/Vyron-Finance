import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { approveAndPostCashbookEntry, cancelCashbookEntry, reverseCashbookEntry, submitCashbookEntry, ValidationError, NotFoundError } from "@/server/services/cashbook-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const body = await request.json();
  const { action } = body;
  const id = Number(transactionId);

  const check = await requirePermission(companyId, "Cashbook:Edit");
  if (!check.ok) return check.response;

  try {
    if (action === "submit") return NextResponse.json({ transaction: await submitCashbookEntry(companyId, id) });
    if (action === "approve-post") return NextResponse.json({ transaction: await approveAndPostCashbookEntry(companyId, id) });
    if (action === "cancel") return NextResponse.json({ transaction: await cancelCashbookEntry(companyId, id) });
    if (action === "reverse") return NextResponse.json({ transaction: await reverseCashbookEntry(companyId, id) });
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
