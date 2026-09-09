import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { previewRecode, ValidationError, type RecodeSelection } from "@/server/services/find-and-recode-service";

/**
 * Phase 23A — Find & Recode's mandatory REVIEW step (SEARCH -> REVIEW ->
 * SELECT -> PREVIEW -> CONFIRM, never SEARCH -> immediately change).
 * Read-only: writes nothing, exists purely so the UI can show the exact
 * count/current-account breakdown/sample before the user commits to
 * anything. Same `Banking:Edit` permission as the commit route and every
 * other transaction-mutating action — viewing a preview requires the
 * same authorization as actually recoding would, since it already
 * reveals real transaction data.
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
    const preview = await previewRecode(companyId, selection, body.newGlAccountCode ?? "");
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
