import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getMatchingQueue } from "@/server/services/matching-queue-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const queue = await getMatchingQueue(companyId);
  return NextResponse.json({ queue });
}
