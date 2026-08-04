import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { createAlert, listAlerts } from "@/server/services/operations-service";
import type { AlertStatus } from "@/server/operations/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") as AlertStatus) || undefined;
  const alerts = await listAlerts(companyId, status);
  return NextResponse.json({ alerts });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const body = await request.json();
  if (!body.sourceEngine || !body.severity || !body.title) {
    return NextResponse.json({ error: "sourceEngine, severity, and title are required." }, { status: 400 });
  }

  const alert = await createAlert({ companyId, sourceEngine: body.sourceEngine, severity: body.severity, title: body.title, message: body.message, createdBy: performedBy });
  return NextResponse.json({ alert }, { status: 201 });
}
