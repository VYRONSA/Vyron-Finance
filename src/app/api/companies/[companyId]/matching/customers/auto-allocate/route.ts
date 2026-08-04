import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { autoAllocateCustomerMatches } from "@/server/services/customer-matching-service";

/** Auto Matching — executes every "Matched"-band candidate the engine
 * found, in descending confidence order. Never mutates anything below
 * the confidence threshold; those stay in "AI Suggestions" for a human. */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const outcome = await autoAllocateCustomerMatches(companyId, performedBy);
  return NextResponse.json({ outcome });
}
