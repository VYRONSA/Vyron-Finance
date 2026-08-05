import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission, requireApproval } from "@/server/services/permission-service";
import {
  editOpeningBalanceEntry, deleteOpeningBalanceEntry, getOpeningBalanceGovernance, ValidationError, NotFoundError,
} from "@/server/services/opening-balance-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; entryId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, entryId } = await params;
  const check = await requirePermission(companyId, "ManageOpeningBalances");
  if (!check.ok) return check.response;

  const body = await request.json();
  const governance = await getOpeningBalanceGovernance(companyId);
  if (governance.requiresGovernance) {
    const approval = await requireApproval(companyId, "ManageOpeningBalances", "OpeningBalance", Math.abs(Number(body.amount) || 0));
    if (!approval.ok) return approval.response;
  }

  const performedBy = await getPerformedByLabel();

  try {
    const entry = await editOpeningBalanceEntry(companyId, Number(entryId), { ...body, performedBy });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ companyId: string; entryId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, entryId } = await params;
  const check = await requirePermission(companyId, "ManageOpeningBalances");
  if (!check.ok) return check.response;

  const body = await request.json().catch(() => ({}));
  const governance = await getOpeningBalanceGovernance(companyId);
  if (governance.requiresGovernance) {
    const approval = await requireApproval(companyId, "ManageOpeningBalances", "OpeningBalance", 0);
    if (!approval.ok) return approval.response;
  }

  const performedBy = await getPerformedByLabel();

  try {
    await deleteOpeningBalanceEntry(companyId, Number(entryId), body.reason, performedBy);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
