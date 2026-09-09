import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getRuleConflicts } from "@/server/services/banking-rule-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const { searchParams } = new URL(request.url);
  const domain = (searchParams.get("domain") ?? "Banking") as Parameters<typeof getRuleConflicts>[1];

  const conflicts = await getRuleConflicts(companyId, domain);
  return NextResponse.json({ conflicts });
}
