import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { listReconciliations, startReconciliation, ValidationError } from "@/server/services/bank-reconciliation-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const bankAccountId = url.searchParams.get("bankAccountId");
  const reconciliations = await listReconciliations(companyId, bankAccountId ? Number(bankAccountId) : undefined);
  return NextResponse.json({ reconciliations });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const { bankAccountId, statementDate, statementClosingBalance } = body;

  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  try {
    const reconciliation = await startReconciliation(companyId, Number(bankAccountId), statementDate, Number(statementClosingBalance), performedBy);
    return NextResponse.json({ reconciliation }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
