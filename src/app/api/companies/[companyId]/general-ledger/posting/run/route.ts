import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";

export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "GeneralLedger:Post");
  if (!check.ok) return check.response;

  try {
    const outcome = await postApprovedJournals(companyId);
    return NextResponse.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Posting failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
