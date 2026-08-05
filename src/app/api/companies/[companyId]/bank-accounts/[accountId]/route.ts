import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import {
  archiveBankAccount,
  editBankAccount,
  getBankAccountSummary,
  listRecentTransactionsForAccount,
  reactivateBankAccount,
  ValidationError,
} from "@/server/services/bank-account-service";
import { getOpeningBalanceGovernance } from "@/server/services/opening-balance-service";
import { requirePermission, requireApproval } from "@/server/services/permission-service";

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
    if (body.openingBalance !== undefined) {
      const governance = await getOpeningBalanceGovernance(companyId);
      if (governance.requiresGovernance) {
        const approval = await requireApproval(companyId, "ManageOpeningBalances", "OpeningBalance", Math.abs(Number(body.openingBalance) || 0));
        if (!approval.ok) return approval.response;
      }
    }
    const performedBy = await getPerformedByLabel();
    const account = await editBankAccount(companyId, Number(accountId), body, performedBy);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
