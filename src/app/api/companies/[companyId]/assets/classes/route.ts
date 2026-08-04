import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createAssetClass, listAssetClasses, ValidationError } from "@/server/services/asset-register-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const assetClasses = await listAssetClasses(companyId);
  return NextResponse.json({ assetClasses });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Assets:Create");
  if (!check.ok) return check.response;

  try {
    const assetClass = await createAssetClass(companyId, body);
    return NextResponse.json({ assetClass }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
