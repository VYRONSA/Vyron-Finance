import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { markNotificationRead } from "@/server/services/notification-service";

export async function PATCH(_request: Request, { params }: { params: Promise<{ companyId: string; notificationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, notificationId } = await params;
  const check = await requirePermission(companyId, "RunAutomation");
  if (!check.ok) return check.response;

  await markNotificationRead(companyId, Number(notificationId));
  return NextResponse.json({ ok: true });
}
