import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { deleteCopilotNarrative } from "@/server/services/narrative-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; narrativeId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, narrativeId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  await deleteCopilotNarrative(companyId, Number(narrativeId));
  return NextResponse.json({ ok: true });
}
