import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getRuleAnalyticsDetailed } from "@/server/services/banking-rule-service";

/** Real per-rule Success %/Failure %/last-applied, not just an applied
 * count — see `banking-rule-service.ts::getRuleAnalyticsDetailed`. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const entries = await getRuleAnalyticsDetailed(companyId);
  return NextResponse.json({ rules: entries });
}
