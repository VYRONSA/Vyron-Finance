import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { commitSupplierRecode, ValidationError, type RecodeSelection } from "@/server/services/find-and-recode-service";

/**
 * Phase 25G — Find & Recode's supplier-recode CONFIRM step. The only
 * write path — mirrors `find-and-recode/commit/route.ts` exactly,
 * targeting `commitSupplierRecode`, which re-resolves and re-validates
 * the selection and target supplier itself rather than trusting a prior
 * preview call.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const selection = body.selection as RecodeSelection;
  const performedBy = await getPerformedByLabel();

  try {
    const outcome = await commitSupplierRecode(companyId, selection, Number(body.newSupplierId), performedBy);
    return NextResponse.json({ outcome });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
