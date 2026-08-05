import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission, requireApproval } from "@/server/services/permission-service";
import { bulkUpsertGlOpeningBalances, getOpeningBalanceGovernance, ValidationError, NotFoundError, type BulkGlOpeningBalanceRow } from "@/server/services/opening-balance-service";

/** Pilot Review Round 1 (Board revision) — the Opening Balances Chart-
 * of-Accounts grid's one save path, used by both "Save Draft" and as the
 * pre-post save. The grid submits every editable row's current state
 * (not a diff) each time; `bulkUpsertGlOpeningBalances` reconciles that
 * against whatever draft entries already exist. The approval-limit check
 * uses the largest single row's amount in the batch, the same threshold
 * the single-entry route already checks per entry — a disclosed,
 * conservative reading of "how much financial exposure is this batch
 * approving," not a new authorization concept. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "ManageOpeningBalances");
  if (!check.ok) return check.response;

  const body = await request.json();
  const rows: BulkGlOpeningBalanceRow[] = Array.isArray(body.rows) ? body.rows : [];

  const governance = await getOpeningBalanceGovernance(companyId);
  if (governance.requiresGovernance) {
    const largestAmount = rows.reduce((max, r) => Math.max(max, Math.abs(Number(r.amount) || 0)), 0);
    const approval = await requireApproval(companyId, "ManageOpeningBalances", "OpeningBalance", largestAmount);
    if (!approval.ok) return approval.response;
  }

  const performedBy = await getPerformedByLabel();

  try {
    const result = await bulkUpsertGlOpeningBalances(companyId, rows, performedBy, body.reason);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
