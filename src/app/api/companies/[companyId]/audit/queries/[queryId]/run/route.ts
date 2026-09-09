import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listAuditQueries, runAuditQuery } from "@/server/services/audit-query-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; queryId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, queryId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const { periodStart, periodEnd } = body;

  const queries = await listAuditQueries(companyId);
  const query = queries.find((q) => q.id === Number(queryId));
  if (!query) return NextResponse.json({ error: "Query not found." }, { status: 404 });

  const results = await runAuditQuery(companyId, query.queryDefinition, periodStart, periodEnd);
  return NextResponse.json({ results });
}
