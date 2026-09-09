import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { disableTask, getAutomationTask, listTaskRuns, pauseTask, resumeTask, runTaskNow, ValidationError } from "@/server/services/scheduler-service";

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
      case "run-now":
        await runTaskNow(companyId, id, new Date().toISOString(), performedBy);
        return NextResponse.json({ ok: true });
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
