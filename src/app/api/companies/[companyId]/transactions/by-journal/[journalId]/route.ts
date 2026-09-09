import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getTransactionsByJournalId } from "@/server/services/transaction-explorer-service";

/** Traceability: the bank transaction(s) a journal was generated from
 * (Transaction Explorer's "Generate Journal" links back via
 * `ae_bank_transactions.journal_id`) — completes the Bank Transaction ->
 * Journal -> GL Transaction chain in the reverse direction, so General
 * Ledger screens (Account Activity, GL Inquiry) can trace a posting back
 * to its source. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; journalId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, journalId } = await params;
  const transactions = await getTransactionsByJournalId(companyId, Number(journalId));
  return NextResponse.json({ transactions });
}
