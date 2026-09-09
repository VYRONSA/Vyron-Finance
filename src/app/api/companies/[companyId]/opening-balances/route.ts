import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission, requireApproval } from "@/server/services/permission-service";
import {
  createOpeningBalanceEntry, listOpeningBalanceEntries, getOpeningBalanceGovernance, ValidationError, NotFoundError,
} from "@/server/services/opening-balance-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageOpeningBalances");
  if (!check.ok) return check.response;

  const [entries, governance] = await Promise.all([listOpeningBalanceEntries(companyId), getOpeningBalanceGovernance(companyId)]);
  return NextResponse.json({ entries, governance });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
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
    const entry = await createOpeningBalanceEntry(companyId, { ...body, performedBy });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
