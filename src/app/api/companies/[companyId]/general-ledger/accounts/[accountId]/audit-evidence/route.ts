import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getAuditEvidenceForAccount } from "@/server/services/audit-evidence-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, accountId } = await params;
  const url = new URL(request.url);
  const accountCode = url.searchParams.get("accountCode") ?? "";

  const evidence = await getAuditEvidenceForAccount(companyId, Number(accountId), accountCode);
  return NextResponse.json({ evidence });
}
