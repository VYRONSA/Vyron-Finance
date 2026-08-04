import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { runAssetIntelligence } from "@/server/services/asset-intelligence-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json().catch(() => ({}));
  const todayIso = body.todayIso ?? new Date().toISOString().slice(0, 10);

  const check = await requirePermission(companyId, "Assets:Edit");
  if (!check.ok) return check.response;

  const result = await runAssetIntelligence(companyId, todayIso, body.highValueThreshold, body.capitalisationThreshold);
  return NextResponse.json(result);
}
