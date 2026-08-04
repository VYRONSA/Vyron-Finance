import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listAssetLifecycleEvents } from "@/server/services/asset-register-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; assetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assetId } = await params;
  const events = await listAssetLifecycleEvents(companyId, Number(assetId));
  return NextResponse.json({ events });
}
