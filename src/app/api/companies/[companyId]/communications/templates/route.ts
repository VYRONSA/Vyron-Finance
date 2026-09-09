import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createTemplate, listTemplates, ValidationError } from "@/server/services/communication-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const templates = await listTemplates(companyId);
  return NextResponse.json({ templates });
}

/** Template administration — the same bar as Roles & Permissions
 * (`SystemAdministration`), since a template edit changes what every
 * future send in the company looks like. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const body = await request.json();
  try {
    const template = await createTemplate(companyId, body, performedBy);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
