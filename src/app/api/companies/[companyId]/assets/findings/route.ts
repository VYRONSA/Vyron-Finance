import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import type { AssetFinding } from "@/server/assets/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId");
  const status = url.searchParams.get("status") as AssetFinding["status"] | null;

  const findings = await listAssetFindings(companyId, { assetId: assetId ? Number(assetId) : undefined, status: status ?? undefined });
  return NextResponse.json({ findings });
}
