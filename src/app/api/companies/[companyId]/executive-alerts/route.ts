import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import type { ExecutiveAlert } from "@/server/reporting/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const status = new URL(request.url).searchParams.get("status") as ExecutiveAlert["status"] | null;
  const executiveAlerts = await listExecutiveAlerts(companyId, status ?? undefined);
  return NextResponse.json({ executiveAlerts });
}
