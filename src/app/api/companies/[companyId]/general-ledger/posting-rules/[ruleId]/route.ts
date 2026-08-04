import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { replacePostingRuleLines, setPostingRuleActive, updatePostingRuleDescription, ValidationError } from "@/server/services/posting-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const id = Number(ruleId);
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Edit");
  if (!check.ok) return check.response;

  try {
    if (typeof body.isActive === "boolean") {
      const postingRule = await setPostingRuleActive(companyId, id, body.isActive);
      return NextResponse.json({ postingRule });
    }
    if (Array.isArray(body.lines)) {
      const postingRule = await replacePostingRuleLines(companyId, id, body.lines);
      return NextResponse.json({ postingRule });
    }
    if (typeof body.description === "string") {
      const postingRule = await updatePostingRuleDescription(companyId, id, body.description);
      return NextResponse.json({ postingRule });
    }
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
