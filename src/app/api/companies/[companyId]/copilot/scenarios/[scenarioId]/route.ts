import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { deleteCopilotScenario } from "@/server/services/scenario-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; scenarioId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, scenarioId } = await params;
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  await deleteCopilotScenario(companyId, Number(scenarioId));
  return NextResponse.json({ ok: true });
}
