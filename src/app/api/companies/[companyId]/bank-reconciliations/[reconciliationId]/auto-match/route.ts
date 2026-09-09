import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { autoMatch, ValidationError, NotFoundError } from "@/server/services/bank-reconciliation-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string; reconciliationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reconciliationId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    const matchedCount = await autoMatch(companyId, Number(reconciliationId));
    return NextResponse.json({ matchedCount });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
