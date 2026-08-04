import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  archiveBankAccount,
  editBankAccount,
  getBankAccountSummary,
  listRecentTransactionsForAccount,
  reactivateBankAccount,
  ValidationError,
} from "@/server/services/bank-account-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, accountId } = await params;
  const summary = await getBankAccountSummary(companyId, Number(accountId));
  if (!summary) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });

  const recentTransactions = await listRecentTransactionsForAccount(companyId, Number(accountId));
  return NextResponse.json({ summary, recentTransactions });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, accountId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  try {
    if (body.action === "archive") {
      const account = await archiveBankAccount(companyId, Number(accountId));
      return NextResponse.json({ account });
    }
    if (body.action === "reactivate") {
      const account = await reactivateBankAccount(companyId, Number(accountId));
      return NextResponse.json({ account });
    }
    const account = await editBankAccount(companyId, Number(accountId), body);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
