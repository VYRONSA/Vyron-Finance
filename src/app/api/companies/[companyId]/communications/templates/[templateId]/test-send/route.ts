import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { NotFoundError, testSend, ValidationError } from "@/server/services/communication-service";

/** The Template Engine's "Test Send" requirement — renders and
 * immediately dispatches to one recipient, bypassing approval, still
 * recorded as a real `communications` row (module `TemplateAdmin`). */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const body = await request.json();
  if (!body.testRecipient) return NextResponse.json({ error: "testRecipient is required." }, { status: 400 });

  try {
    const communication = await testSend(companyId, Number(templateId), body.testRecipient, body.variables ?? {}, performedBy);
    return NextResponse.json({ communication });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
