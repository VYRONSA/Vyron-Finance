import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listDepreciationRunLines } from "@/server/services/depreciation-run-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; runId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { runId } = await params;
  const lines = await listDepreciationRunLines(Number(runId));
  return NextResponse.json({ lines });
}
