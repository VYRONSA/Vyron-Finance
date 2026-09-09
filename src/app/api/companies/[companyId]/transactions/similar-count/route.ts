import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { countSimilarTransactions, ValidationError } from "@/server/services/transaction-explorer-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  try {
    const count = await countSimilarTransactions(companyId, url.searchParams.get("criterion") ?? "", url.searchParams.get("value") ?? "");
    return NextResponse.json({ count });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
