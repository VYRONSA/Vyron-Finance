import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { deleteBankingRule, getBankingRule, setBankingRuleActive, updateBankingRule, NotFoundError, ValidationError } from "@/server/services/banking-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const rule = await getBankingRule(companyId, Number(ruleId));
  if (!rule) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ rule });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const id = Number(ruleId);
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    if (typeof body.isActive === "boolean" && body.conditions === undefined && body.actions === undefined) {
      const rule = await setBankingRuleActive(companyId, id, body.isActive, performedBy);
      return NextResponse.json({ rule });
    }

    const { name, description, priority, isActive, conditions, actions } = body;
    const rule = await updateBankingRule(
      companyId,
      id,
      { name, description, priority, is_active: isActive },
      { conditions, actions },
      performedBy,
    );
    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    await deleteBankingRule(companyId, Number(ruleId), performedBy);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
