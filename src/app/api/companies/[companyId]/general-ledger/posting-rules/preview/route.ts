import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { requirePermission } from "@/server/services/permission-service";

/** A dry run — resolves a rule's lines against sample amounts without
 * creating anything. Lets an accountant "Test Rule" from the Posting
 * Rules tab and see exactly what journal it would produce, same
 * `buildJournalLinesFromRule` core the real event-driven callers
 * (once they exist) will use. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Edit");
  if (!check.ok) return check.response;

  if (!body.eventType) {
    return NextResponse.json({ error: "eventType is required." }, { status: 400 });
  }

  const result = await buildJournalFromEvent(companyId, body.eventType, {
    grossAmount: Number(body.grossAmount) || 0,
    vatRatePercent: Number(body.vatRatePercent) || 0,
    description: body.description || "Test posting",
    accountsByRole: body.accountsByRole ?? {},
  });

  return NextResponse.json({ result });
}
