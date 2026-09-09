import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { listSplitsForTransaction, splitTransaction, unsplitTransaction, ValidationError, NotFoundError } from "@/server/services/split-transaction-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const splits = await listSplitsForTransaction(companyId, Number(transactionId));
  return NextResponse.json({ splits });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    const splits = await splitTransaction(companyId, Number(transactionId), body.lines ?? [], performedBy, body.reason ?? "");
    return NextResponse.json({ splits }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; transactionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, transactionId } = await params;
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  await unsplitTransaction(companyId, Number(transactionId), performedBy);
  return NextResponse.json({ ok: true });
}
