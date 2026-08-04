import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listNotifications, markAllNotificationsRead } from "@/server/services/notification-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const unreadOnly = new URL(request.url).searchParams.get("unreadOnly") === "true";
  const notifications = await listNotifications(companyId, unreadOnly);
  return NextResponse.json({ notifications });
}

export async function PATCH(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;

  await markAllNotificationsRead(companyId);
  return NextResponse.json({ ok: true });
}
