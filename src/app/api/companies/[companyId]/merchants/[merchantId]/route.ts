import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { updateMerchant, ValidationError } from "@/server/services/merchant-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; merchantId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, merchantId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();

  try {
    const merchant = await updateMerchant(companyId, Number(merchantId), body);
    return NextResponse.json({ merchant });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
