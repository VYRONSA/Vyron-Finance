import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import type { VatExceptionStatus } from "@/server/vat/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const status = new URL(request.url).searchParams.get("status") as VatExceptionStatus | null;
  const vatExceptions = await listVatExceptions(companyId, status ?? undefined);
  return NextResponse.json({ vatExceptions });
}
