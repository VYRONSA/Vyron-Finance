import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import type { AuditFinding, AuditFindingCategory } from "@/server/audit/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const category = url.searchParams.get("category") as AuditFindingCategory | null;
  const status = url.searchParams.get("status") as AuditFinding["status"] | null;
  const engagementId = url.searchParams.get("engagementId");

  const findings = await listAuditFindings(companyId, {
    category: category ?? undefined,
    status: status ?? undefined,
    engagementId: engagementId ? Number(engagementId) : undefined,
  });
  return NextResponse.json({ findings });
}
