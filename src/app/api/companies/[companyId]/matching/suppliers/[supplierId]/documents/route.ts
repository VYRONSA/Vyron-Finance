import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getSupplierMatchingDocuments } from "@/server/services/supplier-matching-service";

/** Read-only 3-way-match visibility — this supplier's own Purchase
 * Orders and GRNs, reused from the existing Purchasing services (never
 * a second PO/GRN implementation). */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; supplierId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, supplierId } = await params;
  const documents = await getSupplierMatchingDocuments(companyId, Number(supplierId));
  return NextResponse.json(documents);
}
