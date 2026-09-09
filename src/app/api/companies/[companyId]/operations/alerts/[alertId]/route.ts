import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { acknowledgeAlert, assignAlert, reopenAlert, resolveAlert } from "@/server/services/operations-service";

/** acknowledge | assign | resolve | reopen — the Alert Centre's own
 * workflow, same action-dispatch shape every other approval-bearing
 * route in this codebase uses. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; alertId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, alertId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const body = await request.json();
  const id = Number(alertId);

  switch (body.action) {
    case "acknowledge":
      return NextResponse.json({ alert: await acknowledgeAlert(companyId, id, performedBy) });
    case "assign":
      if (!body.assignedTo) return NextResponse.json({ error: "assignedTo is required." }, { status: 400 });
      return NextResponse.json({ alert: await assignAlert(companyId, id, body.assignedTo) });
    case "resolve":
      return NextResponse.json({ alert: await resolveAlert(companyId, id, performedBy) });
    case "reopen":
      return NextResponse.json({ alert: await reopenAlert(companyId, id) });
    default:
      return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
  }
}
