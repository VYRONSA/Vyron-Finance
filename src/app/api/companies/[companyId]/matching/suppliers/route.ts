import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getSupplierMatchingWorkspace } from "@/server/services/supplier-matching-service";

/** Supplier Matching workspace data — the AP mirror of
 * `/matching/customers`. See `supplier-matching-service.ts`. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const workspace = await getSupplierMatchingWorkspace(companyId);
  return NextResponse.json(workspace);
}
