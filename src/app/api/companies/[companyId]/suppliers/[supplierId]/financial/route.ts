import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getSupplierFinancialSummary } from "@/server/services/supplier-financial-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;
  const url = new URL(request.url);
  const asOfDate = url.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10);

  const summary = await getSupplierFinancialSummary(companyId, Number(supplierId), asOfDate);
  return NextResponse.json({ summary });
}
