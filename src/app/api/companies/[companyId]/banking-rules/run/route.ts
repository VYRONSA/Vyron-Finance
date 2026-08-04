import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { runRuleEngine } from "@/server/services/rule-processing-service";
import { requirePermission } from "@/server/services/permission-service";

/** Runs the Rule Engine -> Posting Engine pipeline over every unprocessed
 * transaction — the manual "Run Rule Engine" trigger, until a real
 * scheduler exists (Recurring Transactions & Automation, the next
 * roadmap module). */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const outcome = await runRuleEngine(companyId, performedBy);
  return NextResponse.json({ outcome });
}
