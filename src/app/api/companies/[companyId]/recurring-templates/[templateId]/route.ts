import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  getRecurringTemplate,
  pauseRecurringTemplate,
  requestActivationApproval,
  resumeRecurringTemplate,
  updateRecurringTemplate,
  ValidationError,
} from "@/server/services/recurring-template-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const template = await getRecurringTemplate(companyId, Number(templateId));
  if (!template) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;

  const id = Number(templateId);
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  try {
    if (body.action === "pause") {
      const template = await pauseRecurringTemplate(companyId, id, performedBy);
      return NextResponse.json({ template });
    }
    if (body.action === "resume") {
      const template = await resumeRecurringTemplate(companyId, id, performedBy);
      return NextResponse.json({ template });
    }
    if (body.action === "request-approval") {
      const instance = await requestActivationApproval(companyId, id, performedBy);
      return NextResponse.json({ instance });
    }

    const { name, endDate, maxOccurrences, skipWeekends, skipPublicHolidays } = body;
    const template = await updateRecurringTemplate(
      companyId,
      id,
      { name, end_date: endDate, max_occurrences: maxOccurrences, skip_weekends: skipWeekends, skip_public_holidays: skipPublicHolidays },
      performedBy,
    );
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
