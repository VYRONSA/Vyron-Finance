import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getCustomerMatchingWorkspace } from "@/server/services/customer-matching-service";

/** Customer Matching workspace data — Invoices, Credit Notes, Debit
 * Notes, Receipts, and every real (receipt, invoice) candidate pairing
 * ("AI Suggestions"). See `customer-matching-service.ts`. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const workspace = await getCustomerMatchingWorkspace(companyId);
  return NextResponse.json(workspace);
}
