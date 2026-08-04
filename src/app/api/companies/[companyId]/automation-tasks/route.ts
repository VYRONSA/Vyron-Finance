import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listAutomationTasks, runDueTasks } from "@/server/services/scheduler-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const tasks = await listAutomationTasks(companyId);
  return NextResponse.json({ tasks });
}

/** Manual "Run Scheduler Now" — processes every due task for this
 * company immediately, the real working path until an external cron
 * trigger is configured (see `automation-cron-secret.ts`). */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;
  const performedBy = await getPerformedByLabel();
  const outcome = await runDueTasks(companyId, new Date().toISOString(), performedBy);
  return NextResponse.json({ outcome });
}
