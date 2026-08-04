import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { NotFoundError, ValidationError, restoreBankingRuleVersion } from "@/server/services/banking-rule-service";
import { requirePermission } from "@/server/services/permission-service";

/** Restores a prior version's content as a brand-new version — never
 * mutates history. See `banking-rule-service.ts::restoreBankingRuleVersion`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const version = Number(body.version);
  if (!Number.isFinite(version)) return NextResponse.json({ error: "A valid version number is required." }, { status: 400 });

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    const rule = await restoreBankingRuleVersion(companyId, Number(ruleId), version, performedBy);
    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
