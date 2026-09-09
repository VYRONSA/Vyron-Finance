import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { editAssetDetails, editAssetDetailsRequiresElevatedPermission, getFixedAsset, NotFoundError, ValidationError } from "@/server/services/asset-register-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; assetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assetId } = await params;
  const asset = await getFixedAsset(companyId, Number(assetId));
  if (!asset) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ asset });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; assetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assetId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Assets:Edit");
  if (!check.ok) return check.response;

  if (editAssetDetailsRequiresElevatedPermission(body)) {
    const elevated = await requirePermission(companyId, "Assets:Approve");
    if (!elevated.ok) return elevated.response;
  }

  try {
    const performedBy = await getPerformedByLabel();
    const asset = await editAssetDetails(companyId, Number(assetId), body, performedBy, body.reason);
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
