import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getRuleComparison } from "@/server/services/banking-rule-service";

/** Rule Comparison — `?ids=1,2,3`, returns those rules' own real
 * analytics side by side, in the requested order. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const idsParam = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));

  const rules = await getRuleComparison(companyId, ids);
  return NextResponse.json({ rules });
}
