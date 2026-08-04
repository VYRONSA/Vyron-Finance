import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { askCopilot } from "@/server/services/copilot-assistant-service";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  if (!(await hasFeature(companyId, "ai_copilot"))) {
    return NextResponse.json({ error: "AI Executive Copilot is not included in your current plan." }, { status: 403 });
  }
  // Commercial Billing Platform — "AI usage exceeded -> Copilot
  // unavailable," enforced through the one Licensing Engine.
  const usageCheck = await checkUsageLimit(companyId, "max_ai_requests_monthly");
  if (!usageCheck.allowed) {
    return NextResponse.json({ error: usageCheck.reason ?? "Your plan's monthly AI request limit has been reached." }, { status: 403 });
  }
  const body = await request.json();
  const { question, periodStart, periodEnd, financialYearStartDate, accountCode } = body;

  if (!question || !periodStart || !periodEnd || !financialYearStartDate) {
    return NextResponse.json({ error: "question, periodStart, periodEnd, and financialYearStartDate are required." }, { status: 400 });
  }

  const answer = await askCopilot(companyId, question, periodStart, periodEnd, financialYearStartDate, accountCode);
  await recordUsageEvent(companyId, "ai_requests");
  return NextResponse.json({ answer });
}
