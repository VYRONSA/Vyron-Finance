import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { DuplicateRunError, executeUnallocation, ForbiddenError, ValidationError } from "@/server/services/bank-unallocation-service";

/**
 * Bulk Unallocate — the CONFIRM step and the only write path. Never trusts
 * the preview: the database re-validates every selected transaction under
 * a row lock and returns, per transaction, whether it was unallocated,
 * skipped (and why) or failed (and why). A repeated request key — a double
 * click or a retry of the same preview — is refused with 409.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const body = await request.json().catch(() => ({}));

  try {
    const result = await executeUnallocation(companyId, body);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof DuplicateRunError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
