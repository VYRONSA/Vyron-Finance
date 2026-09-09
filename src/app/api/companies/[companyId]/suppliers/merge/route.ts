import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { mergeSuppliers, NotFoundError, ValidationError } from "@/server/services/merge-service";

/** Phase 33A — the real, atomic Supplier merge, wired to the explicit-
 * survivor-choice dialog (`supplier-merge-dialog.tsx`). Deliberately a
 * dedicated route rather than a new branch inside the existing
 * `/matching/parties/merge` route: that route's Customer path
 * intentionally still uses the Phase 33 log-only `recordPartyMerge`
 * (Customer merge is out of scope for this phase — see the Phase 33/33A
 * reports), and keeping the two routes separate means neither risks
 * being affected by a change meant for the other. `survivingSupplierId`
 * always comes from the id the user deliberately selected in the dialog
 * — this route never derives a survivor on its own. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  try {
    const result = await mergeSuppliers(companyId, Number(body.survivingSupplierId), Number(body.duplicateSupplierId), performedBy);
    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
