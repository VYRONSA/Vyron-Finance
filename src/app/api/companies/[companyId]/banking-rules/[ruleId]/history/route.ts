import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getRuleHistory } from "@/server/services/banking-rule-service";

/** Rule History — this one rule's own individual applications, most
 * recent first, with each application's real success/failure outcome. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const history = await getRuleHistory(companyId, Number(ruleId));
  return NextResponse.json({ history });
}
