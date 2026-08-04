import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { dismissAlert, resolveAlert } from "@/server/services/executive-alert-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; alertId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, alertId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  if (body.status !== "Resolved" && body.status !== "Dismissed") {
    return NextResponse.json({ error: "status must be 'Resolved' or 'Dismissed'." }, { status: 400 });
  }

  const executiveAlert =
    body.status === "Resolved"
      ? await resolveAlert(companyId, Number(alertId), performedBy, body.note ?? "")
      : await dismissAlert(companyId, Number(alertId), performedBy, body.note ?? "");
  return NextResponse.json({ executiveAlert });
}
