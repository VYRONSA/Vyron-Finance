import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getBankingRule, simulateRule } from "@/server/services/banking-rule-service";
import { listTransactions } from "@/server/services/transaction-explorer-service";

const SIMULATE_SAMPLE_SIZE = 500;

const DEFAULT_FILTERS = {
  search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
  statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false,
  unknownSupplierOnly: false, sortBy: "transactionDate" as const, sortDirection: "desc" as const,
};

/** Runs a rule (in isolation, ignoring is_active and priority against
 * other rules of the same type) against the most recent transactions —
 * the "Simulate"/"Preview" requirement, never mutating anything. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; ruleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, ruleId } = await params;
  const rule = await getBankingRule(companyId, Number(ruleId));
  if (!rule) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { transactions } = await listTransactions(companyId, DEFAULT_FILTERS, null, SIMULATE_SAMPLE_SIZE);
  const evaluable = transactions.map((t) => ({
    id: t.id,
    beneficiary: t.beneficiary,
    description: t.description,
    reference: t.reference,
    notes: t.notes,
    bankAccount: t.bankAccount,
    glAccount: t.glAccount,
    debit: t.debit,
    credit: t.credit,
    amount: t.debit > 0 ? t.debit : t.credit,
  }));

  const result = simulateRule(rule, evaluable);
  return NextResponse.json({ result, sampleSize: transactions.length });
}
