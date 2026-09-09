import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { acquireAsset, listFixedAssets, ValidationError } from "@/server/services/asset-register-service";
import { requirePermission } from "@/server/services/permission-service";
import type { AssetStatus } from "@/server/assets/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const status = new URL(request.url).searchParams.get("status") as AssetStatus | null;
  const assets = await listFixedAssets(companyId, status ?? undefined);
  return NextResponse.json({ assets });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Assets:Create");
  if (!check.ok) return check.response;

  try {
    const asset = await acquireAsset(companyId, performedBy, body);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
