import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { generateFromTemplate, getRecurringTemplate } from "@/server/services/recurring-template-service";

/** Manual "generate now" — runs this template's real generation
 * dispatcher immediately, regardless of its `next_run_date`. Same
 * "manual trigger alongside the real scheduled path" pattern as the
 * Rule Engine's own "Run Rule Engine Now". */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;

  const template = await getRecurringTemplate(companyId, Number(templateId));
  if (!template) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const performedBy = await getPerformedByLabel();
  const todayIso = new Date().toISOString().slice(0, 10);
  const outcome = await generateFromTemplate(companyId, { ...template, nextRunDate: todayIso }, todayIso, performedBy);
  return NextResponse.json({ outcome });
}
