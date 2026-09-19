import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { listAutomationTasks, runDueTasks } from "@/server/services/scheduler-service";
import { recordSystemEvent } from "@/server/services/operations-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const tasks = await listAutomationTasks(companyId);
  return NextResponse.json({ tasks });
}

/** Manual "Run Scheduler Now" — processes every due task for this
 * company immediately, alongside the unattended cron trigger.
 *
 * Phase 5E — `RunAutomation` says a person may work the scheduler. It
 * does not say they may post accounting journals, and some task types do
 * exactly that (`taskPostsAccounting`). The queue is a loop of
 * independently claimed tasks, not one atomic operation, so the honest
 * behaviour is not to refuse the whole request: the non-posting tasks
 * run, and each posting task is left unclaimed and still due, listed in
 * `outcome.refusedTasks`. The scheduled cron pass — service_role, no user
 * permission — runs those tasks as normal, so nothing is lost.
 *
 * This is the only caller that restricts the scheduler. `runDueTasks`
 * without `mayPost` behaves exactly as it always has, which is what the
 * cron route relies on. */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;

  const mayPost = await hasPermission(companyId, "Banking:Post");
  const performedBy = await getPerformedByLabel();
  const outcome = await runDueTasks(companyId, new Date().toISOString(), performedBy, { mayPost });

  // The same observability convention `permission-service` uses for a
  // refusal, recorded once per run that actually skipped something.
  // Fire-and-forget: an observability write must never change what the
  // scheduler did.
  if (outcome.refusedTasks?.length) {
    void recordSystemEvent(
      companyId,
      "PermissionDenied",
      "warning",
      performedBy,
      `Run Scheduler Now skipped ${outcome.refusedTasks.length} due task(s) that post accounting journals — the caller does not have "Banking:Post".`,
      { permissionKey: "Banking:Post", refusedTasks: outcome.refusedTasks.map((t) => ({ taskId: t.taskId, taskType: t.taskType })) },
    );
  }

  return NextResponse.json({ outcome });
}
