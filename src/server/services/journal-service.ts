/**
 * Journal generation for Transaction Explorer's "Generate Journal" bulk
 * action. `JournalService.create`'s validation is ported exactly
 * (`UnbalancedJournalError` equivalent: reject empty lines, reject unless
 * `abs(totalDebit - totalCredit) <= 0.01`) — but the reference has no
 * bank-transaction -> journal derivation anywhere (confirmed by research
 * against the whole `accounting_engine` package), so
 * `buildJournalLinesForTransaction` below is new, designed to be correct
 * by construction: every transaction contributes one self-balancing DR/CR
 * pair, so the journal as a whole can never fail the balance check.
 */

import * as journalRepo from "@/server/repositories/journal-repository";
import * as splitRepo from "@/server/repositories/bank-transaction-split-repository";
import { buildSplitGlLines } from "@/server/matching/split-transaction-engine";
import type { BankTransactionRecord, Journal } from "@/server/accounting/types";

export class ValidationError extends Error {}

export type JournalLineDraft = {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
};

export type BankAccountGlInfo = {
  glAccount: string;
  accountNumber: string;
};

export type BuildJournalLinesResult =
  | { ok: true; lines: JournalLineDraft[] }
  | { ok: false; reason: string };

const BALANCE_TOLERANCE = 0.01;

/** The bank-side control-account code: the account's own configured
 * `glAccount` if set, else a synthetic `BANK-{accountNumber}` code — so a
 * bank account with no GL code assigned yet never blocks generation. */
export function resolveBankGlAccount(bankAccount: BankAccountGlInfo | null, fallbackAccountLabel: string): string {
  const configured = bankAccount?.glAccount?.trim();
  if (configured) return configured;
  if (bankAccount?.accountNumber) return `BANK-${bankAccount.accountNumber}`;
  return `BANK-${fallbackAccountLabel}`;
}

/** Pure, exhaustively unit-tested — the one place a bug would silently
 * corrupt double-entry data. */
export function buildJournalLinesForTransaction(
  transaction: Pick<BankTransactionRecord, "id" | "bankAccount" | "debit" | "credit" | "description" | "suggestedGlAccount" | "journalId">,
  bankAccount: BankAccountGlInfo | null,
): BuildJournalLinesResult {
  if (transaction.journalId !== null) {
    return { ok: false, reason: "Already linked to a journal" };
  }
  if (!transaction.suggestedGlAccount?.trim()) {
    return { ok: false, reason: "No GL account assigned" };
  }
  if (transaction.debit > 0 && transaction.credit > 0) {
    return { ok: false, reason: "Ambiguous debit/credit — cannot journal a row that is both" };
  }
  if (transaction.debit === 0 && transaction.credit === 0) {
    return { ok: false, reason: "No debit or credit amount" };
  }

  const glAccount = transaction.suggestedGlAccount.trim();
  const bankGlAccount = resolveBankGlAccount(bankAccount, transaction.bankAccount);
  const description = transaction.description;

  if (transaction.debit > 0) {
    return {
      ok: true,
      lines: [
        { accountCode: glAccount, debit: transaction.debit, credit: 0, description },
        { accountCode: bankGlAccount, debit: 0, credit: transaction.debit, description },
      ],
    };
  }

  return {
    ok: true,
    lines: [
      { accountCode: bankGlAccount, debit: transaction.credit, credit: 0, description },
      { accountCode: glAccount, debit: 0, credit: transaction.credit, description },
    ],
  };
}

/** The split-aware counterpart to `buildJournalLinesForTransaction` — ONE
 * bank-side line for the full amount, plus one GL-side line PER split
 * (`buildSplitGlLines`, the shared Matching Platform primitive) instead
 * of a single GL-side line. Still exactly one balanced journal contribution
 * per transaction, same as the unsplit path. */
export function buildJournalLinesForSplitTransaction(
  transaction: Pick<BankTransactionRecord, "id" | "bankAccount" | "debit" | "credit" | "description" | "journalId">,
  splits: { amount: number; description: string; glAccount: string }[],
  bankAccount: BankAccountGlInfo | null,
): BuildJournalLinesResult {
  if (transaction.journalId !== null) return { ok: false, reason: "Already linked to a journal" };
  if (transaction.debit > 0 && transaction.credit > 0) return { ok: false, reason: "Ambiguous debit/credit — cannot journal a row that is both" };
  if (transaction.debit === 0 && transaction.credit === 0) return { ok: false, reason: "No debit or credit amount" };
  if (splits.length < 2) return { ok: false, reason: "A split needs at least 2 lines" };

  const isPaymentTxn = transaction.debit > 0;
  const amount = isPaymentTxn ? transaction.debit : transaction.credit;
  const splitTotal = Math.round(splits.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
  if (Math.abs(splitTotal - amount) > BALANCE_TOLERANCE) {
    return { ok: false, reason: `Split lines total ${splitTotal} but the transaction is ${amount}` };
  }

  const bankGlAccount = resolveBankGlAccount(bankAccount, transaction.bankAccount);
  const glLines = buildSplitGlLines(splits, isPaymentTxn);
  const bankLine: JournalLineDraft = isPaymentTxn
    ? { accountCode: bankGlAccount, debit: 0, credit: amount, description: transaction.description }
    : { accountCode: bankGlAccount, debit: amount, credit: 0, description: transaction.description };

  return { ok: true, lines: isPaymentTxn ? [...glLines, bankLine] : [bankLine, ...glLines] };
}

export type GenerateJournalOutcome = {
  journal: Journal | null;
  includedTransactionIds: number[];
  skipped: { transactionId: number; reason: string }[];
};

/** Orchestrates `buildJournalLinesForTransaction` across a selection: one
 * Draft journal covering every eligible transaction, each contributing its
 * own self-balancing line pair (so the combined journal is balanced by
 * construction — still defensively re-checked before insert). Ineligible
 * transactions are skipped and reported, never silently dropped. */
export function generateJournalDraft(
  transactions: Pick<BankTransactionRecord, "id" | "bankAccount" | "bankAccountId" | "debit" | "credit" | "description" | "suggestedGlAccount" | "journalId" | "isSplit">[],
  bankAccountsById: Map<number, BankAccountGlInfo>,
  splitsByTransactionId: Map<number, { amount: number; description: string; glAccount: string }[]> = new Map(),
): { lines: JournalLineDraft[]; includedTransactionIds: number[]; skipped: { transactionId: number; reason: string }[] } {
  const lines: JournalLineDraft[] = [];
  const includedTransactionIds: number[] = [];
  const skipped: { transactionId: number; reason: string }[] = [];

  for (const txn of transactions) {
    const bankAccount = txn.bankAccountId !== null ? (bankAccountsById.get(txn.bankAccountId) ?? null) : null;
    const result = txn.isSplit ? buildJournalLinesForSplitTransaction(txn, splitsByTransactionId.get(txn.id) ?? [], bankAccount) : buildJournalLinesForTransaction(txn, bankAccount);
    if (!result.ok) {
      skipped.push({ transactionId: txn.id, reason: result.reason });
      continue;
    }
    lines.push(...result.lines);
    includedTransactionIds.push(txn.id);
  }

  return { lines, includedTransactionIds, skipped };
}

export async function generateJournalFromTransactions(
  companyId: string,
  transactions: BankTransactionRecord[],
  bankAccountsById: Map<number, BankAccountGlInfo>,
): Promise<GenerateJournalOutcome> {
  const splitTransactionIds = transactions.filter((t) => t.isSplit).map((t) => t.id);
  const splitsByTransactionId = new Map<number, { amount: number; description: string; glAccount: string }[]>();
  if (splitTransactionIds.length > 0) {
    await Promise.all(
      splitTransactionIds.map(async (id) => {
        const splits = await splitRepo.listSplitsForTransaction(companyId, id);
        splitsByTransactionId.set(
          id,
          splits.map((s) => ({ amount: s.amount, description: s.description, glAccount: s.glAccount })),
        );
      }),
    );
  }

  const { lines, includedTransactionIds, skipped } = generateJournalDraft(transactions, bankAccountsById, splitsByTransactionId);

  if (includedTransactionIds.length === 0) {
    return { journal: null, includedTransactionIds, skipped };
  }

  const totalDebit = Math.round(lines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(lines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    throw new ValidationError(`Journal does not balance: total debit ${totalDebit} != total credit ${totalCredit}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Bank Transactions",
    description: `Generated from ${includedTransactionIds.length} transaction(s)`,
    reference: "",
    sourceType: "bank_transactions_bulk",
    sourceId: null,
    status: "Draft",
    lines,
  });

  await Promise.all(includedTransactionIds.map((id) => journalRepo.linkTransactionToJournal(companyId, id, journal.id)));

  return { journal, includedTransactionIds, skipped };
}
