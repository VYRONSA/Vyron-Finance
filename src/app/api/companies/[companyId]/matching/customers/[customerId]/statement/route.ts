import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getCustomerStatement } from "@/server/services/customer-matching-service";

/** Customer Statement — real chronological Invoice/Credit Note/Debit
 * Note/Receipt history with a running balance, for this one customer. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;
  const statement = await getCustomerStatement(companyId, Number(customerId));
  return NextResponse.json({ statement });
}
