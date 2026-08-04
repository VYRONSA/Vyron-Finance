import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { importPostingRulesCsv } from "@/server/services/posting-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const csvText = typeof body.csvText === "string" ? body.csvText : "";

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  const result = await importPostingRulesCsv(companyId, csvText);
  return NextResponse.json(result);
}
