/**
 * Application Service for Split Transactions — validates via the pure
 * `split-transaction-engine.ts` (the sum-to-total invariant), persists
 * via `bank-transaction-split-repository.ts`, and records a real
 * Matching Override for the audit trail every split/un-split is.
 */

import * as repo from "@/server/repositories/bank-transaction-split-repository";
import { getTransaction } from "@/server/repositories/transaction-explorer-repository";
import { recordOverride } from "@/server/repositories/matching-override-repository";
import { validateSplitLines, type SplitLineInput } from "@/server/matching/split-transaction-engine";
import type { BankTransactionSplit } from "@/server/matching/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listSplitsForTransaction = repo.listSplitsForTransaction;

export async function splitTransaction(companyId: string, bankTransactionId: number, lines: SplitLineInput[], performedBy = "System", reason = ""): Promise<BankTransactionSplit[]> {
  const transaction = await getTransaction(companyId, bankTransactionId);
  if (!transaction) throw new NotFoundError(`No transaction with id ${bankTransactionId}.`);
  if (transaction.journalId !== null) throw new ValidationError("This transaction is already journaled — reverse or delete that journal before splitting it.");

  const amount = transaction.debit > 0 ? transaction.debit : transaction.credit;
  const validation = validateSplitLines(lines, amount);
  if (!validation.ok) throw new ValidationError(validation.reason);

  const splits = await repo.replaceSplits(companyId, bankTransactionId, lines);
  await recordOverride(companyId, {
    itemType: "bank_transaction",
    itemId: bankTransactionId,
    fieldName: "split",
    oldValue: "unsplit",
    newValue: `${lines.length} lines`,
    reason: reason || "Split into multiple GL accounts/dimensions.",
    performedBy,
  });
  return splits;
}

export async function unsplitTransaction(companyId: string, bankTransactionId: number, performedBy = "System"): Promise<void> {
  await repo.clearSplits(companyId, bankTransactionId);
  await recordOverride(companyId, {
    itemType: "bank_transaction",
    itemId: bankTransactionId,
    fieldName: "split",
    oldValue: "split",
    newValue: "unsplit",
    reason: "Split removed.",
    performedBy,
  });
}
