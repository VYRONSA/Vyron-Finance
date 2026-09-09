import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listRecentImports } from "@/server/services/import-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const batches = await listRecentImports(companyId);
  return NextResponse.json({ batches });
}
