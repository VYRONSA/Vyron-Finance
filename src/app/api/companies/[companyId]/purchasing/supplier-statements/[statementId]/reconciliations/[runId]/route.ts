import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getStatementReconciliation, verifyStatementReconciliation } from "@/server/services/supplier-statement-reconciliation-service";

/** One reconciliation run and its items. `?verify=1` replays the run from its
 * persisted inputs and reports whether it reproduces exactly. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; statementId: string; runId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { companyId, statementId, runId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;
  const sid = Number(statementId);
  const rid = Number(runId);
  if (!Number.isInteger(sid) || !Number.isInteger(rid)) return NextResponse.json({ error: "Unknown run." }, { status: 400 });

  const detail = await getStatementReconciliation(companyId, sid, rid);
  if (!detail) return NextResponse.json({ error: "Unknown run." }, { status: 404 });
  const verify = new URL(request.url).searchParams.get("verify") === "1";
  return NextResponse.json(verify ? { ...detail, verification: await verifyStatementReconciliation(companyId, sid, rid) } : detail);
}
