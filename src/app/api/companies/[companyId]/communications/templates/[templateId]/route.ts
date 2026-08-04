import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { deleteTemplate, getTemplate, NotFoundError, updateTemplate, ValidationError } from "@/server/services/communication-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const template = await getTemplate(companyId, Number(templateId));
  if (!template) return NextResponse.json({ error: `No template with id ${templateId}.` }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const body = await request.json();
  try {
    const template = await updateTemplate(companyId, Number(templateId), body, performedBy);
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  await deleteTemplate(companyId, Number(templateId));
  return NextResponse.json({ ok: true });
}
