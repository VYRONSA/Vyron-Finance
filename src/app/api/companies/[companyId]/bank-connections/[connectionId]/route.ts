import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { disconnectBankConnection, getBankConnection, listBankConnectionAccounts, NotFoundError } from "@/server/bank-connectivity/bank-connectivity-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; connectionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, connectionId } = await params;
  const check = await requirePermission(companyId, "Banking:View");
  if (!check.ok) return check.response;

  const connection = await getBankConnection(companyId, Number(connectionId));
  if (!connection) return NextResponse.json({ error: "Bank connection not found." }, { status: 404 });
  const accounts = await listBankConnectionAccounts(companyId, connection.id);
  return NextResponse.json({ connection, accounts });
}

/** "Disconnect / Manage" (brief, Part 9). */
export async function DELETE(request: Request, { params }: { params: Promise<{ companyId: string; connectionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, connectionId } = await params;
  const check = await requirePermission(companyId, "Banking:Delete");
  if (!check.ok) return check.response;

  try {
    await disconnectBankConnection(companyId, Number(connectionId), new Date().toISOString());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
