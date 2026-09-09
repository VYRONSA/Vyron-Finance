import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { createCashbookBatch, listCashbookBatches, ValidationError } from "@/server/services/cashbook-service";
import { requirePermission } from "@/server/services/permission-service";
import type { CashbookBatchType } from "@/server/banking/types";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const batches = await listCashbookBatches(companyId);
  return NextResponse.json({ batches });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const { batchDate, batchType, notes } = body;

  const check = await requirePermission(companyId, "Cashbook:Create");
  if (!check.ok) return check.response;

  try {
    const batch = await createCashbookBatch(companyId, batchDate, batchType as CashbookBatchType, notes, performedBy);
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
