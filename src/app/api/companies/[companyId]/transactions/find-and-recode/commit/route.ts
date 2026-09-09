import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { commitRecode, ValidationError, type RecodeSelection } from "@/server/services/find-and-recode-service";

/**
 * Phase 23A — Find & Recode's CONFIRM step. The only write path — always
 * re-resolves and re-validates the selection itself (never trusts that a
 * prior preview call is still accurate; see `commitRecode`'s own
 * docstring), so a transaction that got posted, or a batch that grew
 * past the limit, between preview and confirm is caught here too, not
 * assumed safe because preview once said so.
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
    const outcome = await commitRecode(companyId, selection, body.newGlAccountCode ?? "", performedBy);
    return NextResponse.json({ outcome });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
