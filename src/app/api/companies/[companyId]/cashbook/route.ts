import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listCashbookTransactions } from "@/server/services/cashbook-service";
import type { CashbookFilters } from "@/server/repositories/cashbook-repository";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const filters: CashbookFilters = {
    entrySource: (url.searchParams.get("entrySource") as CashbookFilters["entrySource"]) ?? undefined,
    captureStatus: url.searchParams.get("captureStatus") ?? undefined,
    direction: (url.searchParams.get("direction") as CashbookFilters["direction"]) ?? undefined,
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
  };

  const transactions = await listCashbookTransactions(companyId, filters);
  return NextResponse.json({ transactions });
}
