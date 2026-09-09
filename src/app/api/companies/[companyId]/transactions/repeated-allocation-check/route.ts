import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getRepeatedAllocationCount } from "@/server/services/transaction-explorer-service";

/** Pilot Review Round 1, Phase 7 — called right after a manual (no
 * inline "Create Banking Rule" checkbox) single-transaction allocation,
 * so the UI can prompt "you've allocated this the same way N times —
 * create a rule?" only when it's genuinely a repeated pattern. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const { searchParams } = new URL(request.url);
  const transactionId = Number(searchParams.get("transactionId"));
  const beneficiary = searchParams.get("beneficiary") ?? "";
  const glAccount = searchParams.get("glAccount") ?? undefined;
  const customerId = searchParams.get("customerId") ? Number(searchParams.get("customerId")) : undefined;
  const supplierId = searchParams.get("supplierId") ? Number(searchParams.get("supplierId")) : undefined;

  if (!transactionId || !beneficiary) return NextResponse.json({ error: "transactionId and beneficiary are required." }, { status: 400 });

  const result = await getRepeatedAllocationCount(companyId, transactionId, beneficiary, { glAccount, customerId, supplierId });
  return NextResponse.json(result);
}
