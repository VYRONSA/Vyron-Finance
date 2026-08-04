import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getSupplierStatement } from "@/server/services/supplier-matching-service";

/** Supplier Statement — the AP mirror of `/matching/customers/[customerId]/statement`. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;
  const statement = await getSupplierStatement(companyId, Number(supplierId));
  return NextResponse.json({ statement });
}
