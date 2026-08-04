import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { detectAndRaiseExecutiveAlerts } from "@/server/services/executive-intelligence-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const body = await request.json().catch(() => ({}));
  const referenceDate = body.referenceDate ?? new Date().toISOString().slice(0, 10);

  const raisedCount = await detectAndRaiseExecutiveAlerts(companyId, referenceDate);
  return NextResponse.json({ raisedCount });
}
