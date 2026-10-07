import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  listStatementReconciliations,
  NotFoundError,
  ReconciliationError,
  runStatementReconciliation,
} from "@/server/services/supplier-statement-reconciliation-service";
import { LedgerMismatchError } from "@/server/supplier-statements/reconciliation-input";

type Params = { params: Promise<{ companyId: string; statementId: string }> };

/** The statement's reconciliation runs (newest first) and reviewer decisions. */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { companyId, statementId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;
  const id = Number(statementId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Unknown statement." }, { status: 400 });
  return NextResponse.json(await listStatementReconciliations(companyId, id));
}

/**
 * Runs (or reruns) the reconciliation. READ-ONLY for the books: it compares
 * the statement with the supplier ledger and records the result; it never
 * posts, allocates, adjusts or changes a supplier balance.
 */
export async function POST(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const { companyId, statementId } = await params;
  const check = await requirePermission(companyId, "Purchasing:Edit");
  if (!check.ok) return check.response;
  const id = Number(statementId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Unknown statement." }, { status: 400 });

  try {
    const run = await runStatementReconciliation(companyId, id);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ReconciliationError || error instanceof LedgerMismatchError) return NextResponse.json({ error: error.message }, { status: 409 });
    if ((error as { code?: string } | null)?.code === "42501") return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    throw error;
  }
}
