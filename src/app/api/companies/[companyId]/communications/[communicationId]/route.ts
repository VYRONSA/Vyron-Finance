import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  approveCommunication, cancelCommunication, getCommunication, NotFoundError, rejectCommunication, ValidationError,
} from "@/server/services/communication-service";
import { resolveCommunicationPermissionModule } from "@/server/communications/types";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; communicationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, communicationId } = await params;
  const communication = await getCommunication(companyId, Number(communicationId));
  if (!communication) return NextResponse.json({ error: `No communication with id ${communicationId}.` }, { status: 404 });
  return NextResponse.json({ communication });
}

/** approve | reject | cancel — same action-dispatch shape every other
 * approval-bearing route in this codebase (journals, payments, ...) uses. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; communicationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, communicationId } = await params;
  const id = Number(communicationId);
  const body = await request.json();

  const existing = await getCommunication(companyId, id);
  if (!existing) return NextResponse.json({ error: `No communication with id ${id}.` }, { status: 404 });
  const permissionModule = resolveCommunicationPermissionModule(existing.module);

  const performedBy = await getPerformedByLabel();
  try {
    switch (body.action) {
      case "approve": {
        const check = await requirePermission(companyId, `${permissionModule}:Approve`);
        if (!check.ok) return check.response;
        const communication = await approveCommunication(companyId, id, performedBy, body.note ?? "");
        return NextResponse.json({ communication });
      }
      case "reject": {
        const check = await requirePermission(companyId, `${permissionModule}:Reject`);
        if (!check.ok) return check.response;
        const communication = await rejectCommunication(companyId, id, performedBy, body.note ?? "");
        return NextResponse.json({ communication });
      }
      case "cancel": {
        const check = await requirePermission(companyId, `${permissionModule}:Edit`);
        if (!check.ok) return check.response;
        const communication = await cancelCommunication(companyId, id);
        return NextResponse.json({ communication });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
