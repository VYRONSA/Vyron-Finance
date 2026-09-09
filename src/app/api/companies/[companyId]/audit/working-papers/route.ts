import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listAuditWorkingPapers } from "@/server/services/audit-working-paper-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const engagementId = new URL(request.url).searchParams.get("engagementId");
  const workingPapers = await listAuditWorkingPapers(companyId, engagementId ? Number(engagementId) : undefined);
  return NextResponse.json({ workingPapers });
}
