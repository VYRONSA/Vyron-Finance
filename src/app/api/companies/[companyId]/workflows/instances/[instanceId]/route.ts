import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { decideStep, listWorkflowInstanceSteps, NotFoundError, ValidationError } from "@/server/services/workflow-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; instanceId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { instanceId } = await params;
  const steps = await listWorkflowInstanceSteps(Number(instanceId));
  return NextResponse.json({ steps });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; instanceId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, instanceId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const permissionCheck = await requirePermission(companyId, "RunAutomation");
  if (!permissionCheck.ok) return permissionCheck.response;

  try {
    if (body.decision !== "Approved" && body.decision !== "Rejected") {
      return NextResponse.json({ error: "decision must be 'Approved' or 'Rejected'." }, { status: 400 });
    }
    const instance = await decideStep(companyId, Number(instanceId), body.decision, performedBy, body.note ?? "");
    return NextResponse.json({ instance });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
