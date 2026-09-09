import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getSummary } from "@/server/services/transaction-explorer-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const summary = await getSummary(companyId);
  return NextResponse.json({ summary });
}
