import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { buildBankingRulesCsv, listBankingRules } from "@/server/services/banking-rule-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const rules = await listBankingRules(companyId);
  const csv = buildBankingRulesCsv(rules);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="banking-rules.csv"`,
    },
  });
}
