import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { linkBankConnectionAccount, listProviderAccounts, NotFoundError, ValidationError } from "@/server/bank-connectivity/bank-connectivity-service";

/** "Accounts retrieved" (brief, Part 6) — the real, authorized list of
 * accounts FNB returns for this connection, fetched live (never
 * fabricated/cached as fact — brief, Part 12: "do NOT fabricate
 * balances/transactions"; the same discipline applies to the account
 * list itself). */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; connectionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, connectionId } = await params;
  const check = await requirePermission(companyId, "Banking:View");
  if (!check.ok) return check.response;

  try {
    const accounts = await listProviderAccounts(companyId, Number(connectionId), new Date().toISOString());
    return NextResponse.json({ accounts });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** "Customer selects/links accounts" (brief, Part 6). */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; connectionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, connectionId } = await params;
  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  const body = await request.json();
  const { providerAccountId, accountHolderName, maskedAccountNumber, currency, targetBankAccountId, newBankAccountName } = body;
  if (!providerAccountId) {
    return NextResponse.json({ error: "providerAccountId is required." }, { status: 400 });
  }

  try {
    const linked = await linkBankConnectionAccount(companyId, {
      connectionId: Number(connectionId),
      providerAccountId,
      accountHolderName: accountHolderName ?? "",
      maskedAccountNumber: maskedAccountNumber ?? "",
      currency: currency ?? "ZAR",
      targetBankAccountId: targetBankAccountId ? Number(targetBankAccountId) : null,
      newBankAccountName: newBankAccountName ?? null,
    });
    return NextResponse.json({ linked }, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
