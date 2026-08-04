import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getBankingRule, testRule } from "@/server/services/banking-rule-service";
import { requirePermission } from "@/server/services/permission-service";

/** "Test Rule" — evaluates a hand-built hypothetical record (posted in
 * the request body) against the rule, never mutating anything. Distinct
 * from `/simulate` (bulk dry-run against the most recent real
 * transactions) — see `rule-engine.ts::testRuleAgainstRecord`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const rule = await getBankingRule(companyId, Number(ruleId));
  if (!rule) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json();
  const record: Record<string, string | number> = typeof body.record === "object" && body.record !== null ? body.record : {};

  const result = testRule(rule, record);
  return NextResponse.json({ result });
}
