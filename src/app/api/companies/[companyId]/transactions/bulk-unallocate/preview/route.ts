import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { ForbiddenError, previewUnallocation, ValidationError } from "@/server/services/bank-unallocation-service";

/**
 * Bulk Unallocate — the mandatory PREVIEW step. Read-only. `Banking:Edit`,
 * the same as the execute route and Find & Recode's preview: it is the
 * step before a change and already reveals transaction data. The database
 * function checks the same permission again for itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const body = await request.json().catch(() => ({}));

  try {
    const preview = await previewUnallocation(companyId, body ?? {});
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
