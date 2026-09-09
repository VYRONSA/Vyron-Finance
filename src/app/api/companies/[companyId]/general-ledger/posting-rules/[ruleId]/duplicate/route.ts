import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { duplicatePostingRule, NotFoundError, ValidationError } from "@/server/services/posting-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  try {
    const postingRule = await duplicatePostingRule(companyId, Number(ruleId), body.eventType ?? "");
    return NextResponse.json({ postingRule }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
