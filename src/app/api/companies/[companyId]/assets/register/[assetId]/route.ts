import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getFixedAsset } from "@/server/services/asset-register-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; assetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assetId } = await params;
  const asset = await getFixedAsset(companyId, Number(assetId));
  if (!asset) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ asset });
}
