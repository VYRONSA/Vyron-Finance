import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { ReconciliationError, recordStatementResolution, type ResolutionRequest } from "@/server/services/supplier-statement-reconciliation-service";

/**
 * Records a reviewer's reconciliation decision — a manual link, an
 * explanation, or the revocation of an earlier one. Append-only; a reason is
 * always required; the actor is the session's (never the body's). It takes
 * effect at the next run and changes no accounting record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; statementId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { companyId, statementId } = await params;
  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;
  const id = Number(statementId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Unknown statement." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const optionalId = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const decision: ResolutionRequest = {
    action: body.action as ResolutionRequest["action"],
    statementLineId: optionalId(body.statementLineId),
    refType: typeof body.refType === "string" ? body.refType : null,
    refId: optionalId(body.refId),
    revokesResolutionId: optionalId(body.revokesResolutionId),
    reason: typeof body.reason === "string" ? body.reason : "",
  };
  try {
    const resolutionId = await recordStatementResolution(companyId, id, decision);
    return NextResponse.json({ resolutionId }, { status: 201 });
  } catch (error) {
    if (error instanceof ReconciliationError) return NextResponse.json({ error: error.message }, { status: 400 });
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501" || code === "22023" || code === "23514") return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    throw error;
  }
}
