import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { duplicateChartOfAccount, NotFoundError, ValidationError } from "@/server/services/chart-of-accounts-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, accountId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  try {
    const account = await duplicateChartOfAccount(companyId, Number(accountId), body.accountCode ?? "");
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
