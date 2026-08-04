import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import type { ExceptionStatus } from "@/server/banking-rules/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const status = new URL(request.url).searchParams.get("status") as ExceptionStatus | null;
  const exceptions = await listBankingExceptions(companyId, status ?? undefined);
  return NextResponse.json({ exceptions });
}
