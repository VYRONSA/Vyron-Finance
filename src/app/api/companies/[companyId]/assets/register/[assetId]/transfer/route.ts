import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { transferAsset, ValidationError } from "@/server/services/asset-register-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; assetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assetId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Assets:Edit");
  if (!check.ok) return check.response;

  try {
    const asset = await transferAsset(companyId, Number(assetId), body, performedBy);
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
