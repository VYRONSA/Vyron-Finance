import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getMerchantStats, ValidationError } from "@/server/services/transaction-explorer-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  try {
    const stats = await getMerchantStats(companyId, url.searchParams.get("beneficiary") ?? "");
    return NextResponse.json({ stats });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
