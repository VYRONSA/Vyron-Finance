import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getDuplicateFindings } from "@/server/services/duplicate-detection-service";

/** Every duplicate finding across all 12 entity types the Matching
 * Platform tracks — see `duplicate-detection-service.ts`. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const todayIso = new Date().toISOString().slice(0, 10);
  const findings = await getDuplicateFindings(companyId, todayIso);
  return NextResponse.json({ findings });
}
