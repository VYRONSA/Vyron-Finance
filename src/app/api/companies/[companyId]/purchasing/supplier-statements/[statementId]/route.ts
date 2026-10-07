import { after, NextResponse } from "next/server";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  confirmStatementSupplier,
  correctStatementHeader,
  correctStatementLines,
  getSupplierStatement,
  markStatementReady,
  NotFoundError,
  processStatement,
  rejectStatement,
  reopenStatement,
  requeueStatement,
  startStatementManualEntry,
  submitStatementForReview,
  unconfirmStatementSupplier,
  ValidationError,
} from "@/server/services/supplier-statement-service";
import { NotFoundError as SupplierNotFoundError, ValidationError as SupplierValidationError } from "@/server/services/supplier-management-service";

type Params = { params: Promise<{ companyId: string; statementId: string }> };

/** One statement: header, lines (exactly as stored), findings and history. */
export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, statementId } = await params;
  const check = await requirePermission(companyId, "Purchasing:View");
  if (!check.ok) return check.response;

  const id = Number(statementId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Unknown statement." }, { status: 400 });
  const detail = await getSupplierStatement(companyId, id);
  if (!detail) return NextResponse.json({ error: "Unknown statement." }, { status: 404 });
  return NextResponse.json(detail);
}

/** Every action a reviewer can take, each needing its own permission
 * (checked here before anything is looked up, and again by the database). */
const ACTION_PERMISSION: Record<string, "Purchasing:Edit" | "Purchasing:Reject"> = {
  "correct-header": "Purchasing:Edit",
  "correct-lines": "Purchasing:Edit",
  "start-manual-entry": "Purchasing:Edit",
  "submit-for-review": "Purchasing:Edit",
  "confirm-supplier": "Purchasing:Edit",
  "unconfirm-supplier": "Purchasing:Edit",
  "mark-ready": "Purchasing:Edit",
  reopen: "Purchasing:Edit",
  requeue: "Purchasing:Edit",
  reject: "Purchasing:Reject",
};

export async function PATCH(request: Request, { params }: Params) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, statementId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const permission = ACTION_PERMISSION[action];
  if (!permission) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  // (Saving the account number on the supplier is a supplier edit, which is
  // the same Purchasing:Edit this action already requires.)
  const check = await requirePermission(companyId, permission);
  if (!check.ok) return check.response;

  const id = Number(statementId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Unknown statement." }, { status: 400 });

  try {
    switch (action) {
      case "correct-header":
        await correctStatementHeader(companyId, id, (body.header ?? {}) as Parameters<typeof correctStatementHeader>[2]);
        break;
      case "correct-lines":
        await correctStatementLines(companyId, id, (body.lines ?? {}) as Parameters<typeof correctStatementLines>[2]);
        break;
      case "start-manual-entry":
        await startStatementManualEntry(companyId, id);
        break;
      case "submit-for-review":
        await submitStatementForReview(companyId, id);
        break;
      case "confirm-supplier":
        await confirmStatementSupplier(companyId, id, Number(body.supplierId), { saveAccountNumber: body.saveAccountNumber === true });
        break;
      case "unconfirm-supplier":
        await unconfirmStatementSupplier(companyId, id);
        break;
      case "mark-ready":
        await markStatementReady(companyId, id);
        break;
      case "reopen":
        await reopenStatement(companyId, id);
        break;
      case "reject":
        await rejectStatement(companyId, id, typeof body.reason === "string" ? body.reason : "");
        break;
      case "requeue": {
        await requeueStatement(companyId, id);
        const performedBy = await getPerformedByLabel();
        after(async () => {
          try {
            await processStatement(companyId, id, performedBy);
          } catch (error) {
            console.error("Supplier statement processing did not complete.", { companyId, statementId: id, error: error instanceof Error ? error.name : "error" });
          }
        });
        break;
      }
    }
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof SupplierNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError || error instanceof SupplierValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    const code = (error as { code?: string } | null)?.code;
    // The database refused (permission, state, same-company rule).
    if (code === "42501") return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    throw error;
  }

  const detail = await getSupplierStatement(companyId, id);
  return NextResponse.json(detail);
}
