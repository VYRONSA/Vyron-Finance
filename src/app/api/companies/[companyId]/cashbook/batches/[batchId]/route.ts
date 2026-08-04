import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { approveAndPostBatch, listBatchTransactions, ValidationError, NotFoundError } from "@/server/services/cashbook-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; batchId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, batchId } = await params;
  const transactions = await listBatchTransactions(companyId, Number(batchId));
  return NextResponse.json({ transactions });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; batchId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, batchId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Cashbook:Edit");
  if (!check.ok) return check.response;

  try {
    if (body.action === "approve-post") {
      const batch = await approveAndPostBatch(companyId, Number(batchId));
      return NextResponse.json({ batch });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
