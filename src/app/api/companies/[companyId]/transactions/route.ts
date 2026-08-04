import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listTransactions, parseFilters, ValidationError } from "@/server/services/transaction-explorer-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);

  try {
    const filters = parseFilters(url.searchParams);
    const cursor = url.searchParams.get("cursor");
    const pageSizeRaw = url.searchParams.get("pageSize");
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
    const result = await listTransactions(companyId, filters, cursor, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
