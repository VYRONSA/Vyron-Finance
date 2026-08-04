import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createChartOfAccount, listChartOfAccounts, ValidationError } from "@/server/services/chart-of-accounts-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const accounts = await listChartOfAccounts(companyId);
  return NextResponse.json({ accounts });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Create");
  if (!check.ok) return check.response;

  try {
    const account = await createChartOfAccount(companyId, body);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
