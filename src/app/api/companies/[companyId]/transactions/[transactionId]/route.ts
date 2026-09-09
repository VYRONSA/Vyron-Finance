import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getTransactionDetail } from "@/server/services/transaction-explorer-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const detail = await getTransactionDetail(companyId, Number(transactionId));
  if (!detail) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  return NextResponse.json({ detail });
}
