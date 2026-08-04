import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { importBankingRulesCsv } from "@/server/services/banking-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const csvText = typeof body.csvText === "string" ? body.csvText : "";
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  const result = await importBankingRulesCsv(companyId, csvText, performedBy);
  return NextResponse.json(result);
}
