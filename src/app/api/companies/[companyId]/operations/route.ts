import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { buildCompanyOperationsSnapshot } from "@/server/services/operations-service";

/** The RC1 Phase 6 Operations Centre's per-company snapshot — every
 * section (Engine Health, Background Processing, Integration Health,
 * Communication Health, Security, Performance, Audit, Alerts, Tenant
 * Health) in one real, computed response. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "SystemAdministration");
  if (!check.ok) return check.response;

  const snapshot = await buildCompanyOperationsSnapshot(companyId, new Date().toISOString());
  return NextResponse.json({ snapshot });
}
