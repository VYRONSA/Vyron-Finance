import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { getBankConnection, listBankConnectionAccounts } from "@/server/bank-connectivity/bank-connectivity-service";
import { syncBankConnectionAccount } from "@/server/bank-connectivity/bank-sync-service";

/**
 * "Sync Now" (brief, Part 9) and the very first sync right after linking
 * accounts (brief, Part 7). Syncs every Active linked account under this
 * connection — one account's failure doesn't block the others, matching
 * `syncAllConnectedAccounts`'s own per-account isolation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; connectionId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, connectionId } = await params;
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const connection = await getBankConnection(companyId, Number(connectionId));
  if (!connection) return NextResponse.json({ error: "Bank connection not found." }, { status: 404 });

  const nowIso = new Date().toISOString();
  const performedBy = await getPerformedByLabel();
  const linkedAccounts = (await listBankConnectionAccounts(companyId, connection.id)).filter((a) => a.status === "Active");

  const results = await Promise.all(
    linkedAccounts.map(async (linkedAccount) => {
      try {
        const outcome = await syncBankConnectionAccount(companyId, linkedAccount, connection, nowIso, performedBy);
        return { bankConnectionAccountId: linkedAccount.id, status: "Success" as const, ...outcome };
      } catch (error) {
        return { bankConnectionAccountId: linkedAccount.id, status: "Failed" as const, message: error instanceof Error ? error.message : "Unknown sync error." };
      }
    }),
  );

  return NextResponse.json({ results });
}
