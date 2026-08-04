import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listBankingRuleVersions } from "@/server/services/banking-rule-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { ruleId } = await params;
  const versions = await listBankingRuleVersions(Number(ruleId));
  return NextResponse.json({ versions });
}
