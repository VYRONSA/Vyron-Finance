import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { autoAllocateSupplierMatches } from "@/server/services/supplier-matching-service";

/** Auto Matching — the AP mirror of `/matching/customers/auto-allocate`. */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  const outcome = await autoAllocateSupplierMatches(companyId, performedBy);
  return NextResponse.json({ outcome });
}
