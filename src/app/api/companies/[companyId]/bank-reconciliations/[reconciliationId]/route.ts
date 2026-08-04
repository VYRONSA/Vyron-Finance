import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { completeReconciliation, getReconciliationSummary, reopenReconciliation, ValidationError, NotFoundError } from "@/server/services/bank-reconciliation-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; reconciliationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reconciliationId } = await params;
  try {
    const summary = await getReconciliationSummary(companyId, Number(reconciliationId));
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; reconciliationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reconciliationId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const id = Number(reconciliationId);

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    if (body.action === "complete") {
      const reconciliation = await completeReconciliation(companyId, id, performedBy, Boolean(body.lockMonthEnd));
      return NextResponse.json({ reconciliation });
    }
    if (body.action === "reopen") {
      const reconciliation = await reopenReconciliation(companyId, id, performedBy, body.reason ?? "");
      return NextResponse.json({ reconciliation });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
