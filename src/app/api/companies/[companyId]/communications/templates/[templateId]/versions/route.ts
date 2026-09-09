import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listTemplateVersions } from "@/server/services/communication-service";

/** Version history — the Template Engine's "Version history" requirement. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; templateId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { templateId } = await params;
  const versions = await listTemplateVersions(Number(templateId));
  return NextResponse.json({ versions });
}
