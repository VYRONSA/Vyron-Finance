import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createPostingRule, listPostingRules, ValidationError } from "@/server/services/posting-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const postingRules = await listPostingRules(companyId);
  return NextResponse.json({ postingRules });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  try {
    const postingRule = await createPostingRule(companyId, body);
    return NextResponse.json({ postingRule }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
