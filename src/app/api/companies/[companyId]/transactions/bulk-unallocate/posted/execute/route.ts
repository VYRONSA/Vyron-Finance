import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { DuplicateRunError, executeUnposting, ForbiddenError, ValidationError } from "@/server/services/bank-unallocation-service";

/**
 * Bulk Unpost (migration 0120) — the CONFIRM step and the only write path
 * for POSTED transactions. Never trusts the preview: the database
 * re-validates every selected transaction and its journal under locks,
 * reverses each journal whole (dated at its own date) or not at all, and
 * returns, per transaction, whether it was unposted, skipped (and why) or
 * failed (and why). A repeated request key is refused with 409.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const bankingCheck = await requirePermission(companyId, "Banking:Edit");
  if (!bankingCheck.ok) return bankingCheck.response;
  const reverseCheck = await requirePermission(companyId, "GeneralLedger:Reverse");
  if (!reverseCheck.ok) return reverseCheck.response;

  const body = await request.json().catch(() => ({}));

  try {
    const result = await executeUnposting(companyId, body);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof DuplicateRunError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
