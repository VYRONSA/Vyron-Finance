import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { hasPermission, requirePermission } from "@/server/services/permission-service";
import { disableTask, getAutomationTask, listTaskRuns, pauseTask, resumeTask, runTaskNow, taskPostsAccounting, ValidationError } from "@/server/services/scheduler-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; taskId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, taskId } = await params;
  const id = Number(taskId);
  const [task, runs] = await Promise.all([getAutomationTask(companyId, id), listTaskRuns(companyId, id)]);
  if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ task, runs });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; taskId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, taskId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;
  const id = Number(taskId);
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  try {
    switch (body.action) {
      case "pause":
        await pauseTask(companyId, id);
        return NextResponse.json({ ok: true });
      case "resume":
        await resumeTask(companyId, id);
        return NextResponse.json({ ok: true });
      case "disable":
        await disableTask(companyId, id);
        return NextResponse.json({ ok: true });
      // Phase 5D — `RunAutomation` (checked above) says a person may work
      // the scheduler. It does NOT say they may post accounting journals,
      // and a RuleEngineRun or BankSync run does exactly that — so a
      // manual run of one needs `Banking:Post`, the same permission its
      // own manual trigger requires. Checked here, with
      // `requirePermission`, so the refusal is a real 403 and is recorded
      // as a `PermissionDenied` event like every other one.
      //
      // The task is read first only to learn its TYPE. The task-state
      // rules (Suspended and Disabled are refused) live in `runTaskNow`
      // itself, which re-reads the task — this route never decides them,
      // so no other caller can get around them.
      case "run-now": {
        const task = await getAutomationTask(companyId, id);
        if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });
        const mayPost = await hasPermission(companyId, "Banking:Post");
        if (taskPostsAccounting(task.taskType) && !mayPost) {
          // Re-asked through `requirePermission` purely so the refusal is
          // the standard 403 and is recorded as a `PermissionDenied`
          // event — only on the refusal path, which is the rare one.
          const postCheck = await requirePermission(companyId, "Banking:Post");
          if (!postCheck.ok) return postCheck.response;
        }
        await runTaskNow(companyId, id, new Date().toISOString(), performedBy, { mayPost });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
