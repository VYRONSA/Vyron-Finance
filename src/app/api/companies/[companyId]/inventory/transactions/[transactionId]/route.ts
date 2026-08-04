import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveAndPostTransaction,
  cancelTransaction,
  getInventoryTransaction,
  NotFoundError,
  retryPostTransaction,
  submitTransaction,
  ValidationError,
} from "@/server/services/inventory-transaction-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const transaction = await getInventoryTransaction(companyId, Number(transactionId));
  if (!transaction) return NextResponse.json({ error: "Inventory transaction not found." }, { status: 404 });
  return NextResponse.json({ transaction });
}

/** `approve` performs the real, automatic Approve -> Posting Rule ->
 * Journal -> Posting Engine chain — see
 * `inventory-transaction-service.ts::approveAndPostTransaction`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const id = Number(transactionId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Inventory:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "submit": {
        const transaction = await submitTransaction(companyId, id);
        return NextResponse.json({ transaction });
      }
      case "approve": {
        const transaction = await approveAndPostTransaction(companyId, id);
        return NextResponse.json({ transaction });
      }
      case "retry-post": {
        const transaction = await retryPostTransaction(companyId, id);
        return NextResponse.json({ transaction });
      }
      case "cancel": {
        const transaction = await cancelTransaction(companyId, id);
        return NextResponse.json({ transaction });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
