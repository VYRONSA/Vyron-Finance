import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { NotFoundError, previewTemplate } from "@/server/services/communication-service";

/** The Template Engine's "Preview" requirement — renders subject/body
 * with caller-supplied variables, no send, no persisted row. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, templateId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const body = await request.json();
  try {
    const preview = await previewTemplate(companyId, Number(templateId), body.variables ?? {});
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
