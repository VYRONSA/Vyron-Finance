import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listRateHistory } from "@/server/services/vat-treatment-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; vatTreatmentId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { vatTreatmentId } = await params;
  const rateHistory = await listRateHistory(Number(vatTreatmentId));
  return NextResponse.json({ rateHistory });
}
