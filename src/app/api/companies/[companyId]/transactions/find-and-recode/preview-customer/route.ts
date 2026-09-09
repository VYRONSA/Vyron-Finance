import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { previewCustomerRecode, ValidationError, type RecodeSelection } from "@/server/services/find-and-recode-service";

/**
 * Phase 25G — Find & Recode's customer-recode REVIEW step. Read-only —
 * mirrors `find-and-recode/preview/route.ts` exactly, targeting
 * `previewCustomerRecode` instead of `previewRecode`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const selection = body.selection as RecodeSelection;

  try {
    const preview = await previewCustomerRecode(companyId, selection, Number(body.newCustomerId));
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
