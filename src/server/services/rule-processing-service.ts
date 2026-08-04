/**
 * The Rule Engine's real orchestration — Business Event (a bank
 * transaction) -> Rule Engine (`evaluateTransactionAgainstRules`) ->
 * Posting Engine (`postApprovedJournals`) -> General Ledger, exactly the
 * pipeline the Product Review Board's brief describes, with no
 * alternative workflow introduced: journal LINE building reuses
 * `journal-service.ts::buildJournalLinesForTransaction` (the exact same
 * pure function Transaction Explorer's existing manual "Generate
 * Journal" bulk action calls — the only difference is this pipeline
 * creates the journal `Approved` and immediately runs it through
 * `postApprovedJournals`, the one shared Posting Engine, rather than
 * leaving it `Draft` for manual review). A Bank Fee / Interest rule
 * reaches the Posting Engine by resolving its GL action to the SAME
 * account code (6100 / 6200) the already-existing 'Bank Charges' /
 * 'Interest Received' posting rules use — no new posting-rule row is
 * ever created for it.
 *
 * "Unknown transactions should become the exception — not the normal
 * workflow": a transaction with no rule match and no existing
 * Matching-Engine supplier match becomes an `UnknownMerchant` exception,
 * not a silently-skipped row.
 */

import * as explorerRepo from "@/server/repositories/transaction-explorer-repository";
import * as ruleRepo from "@/server/repositories/banking-rule-repository";
import * as exceptionRepo from "@/server/repositories/banking-exception-repository";
import * as merchantRepo from "@/server/repositories/merchant-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { buildJournalLinesForTransaction, type BankAccountGlInfo } from "@/server/services/journal-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { evaluateTransactionAgainstRules, type EvaluableTransaction } from "@/server/banking-rules/rule-engine";
import { buildBankingIntelligence, type IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";
import type { BankingRule } from "@/server/banking-rules/types";
import type { BankTransactionRecord } from "@/server/accounting/types";

const LARGE_PAYMENT_THRESHOLD = 50_000;

function toEvaluable(t: BankTransactionRecord): EvaluableTransaction {
  return {
    beneficiary: t.beneficiary,
    description: t.description,
    reference: t.reference,
    notes: t.notes,
    bankAccount: t.bankAccount,
    glAccount: t.glAccount,
    debit: t.debit,
    credit: t.credit,
    // The Rule Engine no longer computes this itself (see rule-engine.ts's
    // module docstring — field resolution is now plain property access,
    // generalized across every automation domain); Banking's own
    // "amount" convenience field is added here instead.
    amount: t.debit > 0 ? t.debit : t.credit,
  };
}

export type TransactionProcessingResult = {
  transactionId: number;
  matchedRuleIds: number[];
  autoPosted: boolean;
  journalId: number | null;
  exceptionsRaised: string[];
};

/** One transaction through the pipeline. Never throws for a single bad
 * transaction — a posting failure downgrades to "resolved but not
 * posted" (the same honest "Approved but Posting Engine skipped it" gap
 * every other `approveAndPostX` in this codebase discloses and recovers
 * from via its own retry path) rather than aborting the whole batch. */
export async function processTransaction(
  companyId: string,
  transaction: BankTransactionRecord,
  activeRules: BankingRule[],
  bankAccountsById: Map<number, BankAccountGlInfo>,
  performedBy: string,
): Promise<TransactionProcessingResult> {
  const exceptionsRaised: string[] = [];

  if (transaction.journalId !== null) {
    return { transactionId: transaction.id, matchedRuleIds: [], autoPosted: false, journalId: transaction.journalId, exceptionsRaised };
  }

  const { matchedRules, actions } = evaluateTransactionAgainstRules(toEvaluable(transaction), activeRules);

  if (matchedRules.length === 0 && transaction.matchedSupplierId === null && transaction.matchedCustomerId === null) {
    await exceptionRepo.raiseExceptionIdempotent(companyId, {
      bankTransactionId: transaction.id,
      exceptionType: "UnknownMerchant",
      reason: `No banking rule matched, and no supplier/customer has been identified for "${transaction.beneficiary}".`,
      evidence: `Beneficiary: ${transaction.beneficiary}; Description: ${transaction.description}; Amount: ${(transaction.debit || transaction.credit).toFixed(2)}.`,
      recommendedAction: "Assign a Merchant, Supplier, or Customer, or create a rule that recognises this beneficiary.",
    });
    exceptionsRaised.push("UnknownMerchant");
    return { transactionId: transaction.id, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised };
  }

  let resolvedGlAccount = transaction.suggestedGlAccount;
  let resolvedVatCode = transaction.suggestedVatCode;
  let resolvedMerchantId: number | undefined;
  let resolvedSupplierId: number | undefined;
  let resolvedCustomerId: number | undefined;
  let flaggedReason: string | null = null;

  for (const action of actions) {
    switch (action.actionType) {
      case "set_merchant":
        if (action.targetId !== null) resolvedMerchantId = action.targetId;
        break;
      case "set_supplier":
        if (action.targetId !== null) resolvedSupplierId = action.targetId;
        break;
      case "set_customer":
        if (action.targetId !== null) resolvedCustomerId = action.targetId;
        break;
      case "set_gl_account":
        if (action.targetText) resolvedGlAccount = action.targetText;
        break;
      case "set_vat_code":
        if (action.targetText) resolvedVatCode = action.targetText;
        break;
      case "flag_for_review":
        flaggedReason = action.targetText ?? "A matching rule flagged this transaction for review.";
        break;
    }
  }

  const winningRule = matchedRules.find((r) => r.ruleType === "GL") ?? matchedRules[0];

  await explorerRepo.applyRuleActions(
    companyId,
    transaction.id,
    {
      matchedMerchantId: resolvedMerchantId,
      matchedSupplierId: resolvedSupplierId,
      matchedCustomerId: resolvedCustomerId,
      suggestedGlAccount: resolvedGlAccount ?? undefined,
      suggestedVatCode: resolvedVatCode ?? undefined,
      ruleId: winningRule?.id,
      allocationStatus: resolvedSupplierId !== undefined || resolvedCustomerId !== undefined ? "Allocated" : "Suggested",
    },
    winningRule?.name ?? "Unnamed rule",
    performedBy,
  );

  await Promise.all(matchedRules.map((rule) => ruleRepo.recordRuleApplication(companyId, rule.id, transaction.id)));

  if (flaggedReason) {
    await exceptionRepo.raiseExceptionIdempotent(companyId, {
      bankTransactionId: transaction.id,
      exceptionType: "UnbalancedAllocation",
      reason: flaggedReason,
      evidence: `Flagged by rule "${winningRule?.name ?? "unknown"}".`,
      recommendedAction: "Review this transaction manually before it is posted.",
    });
    exceptionsRaised.push("UnbalancedAllocation");
    return { transactionId: transaction.id, matchedRuleIds: matchedRules.map((r) => r.id), autoPosted: false, journalId: null, exceptionsRaised };
  }

  if (!resolvedGlAccount) {
    return { transactionId: transaction.id, matchedRuleIds: matchedRules.map((r) => r.id), autoPosted: false, journalId: null, exceptionsRaised };
  }

  const bankAccount = transaction.bankAccountId !== null ? (bankAccountsById.get(transaction.bankAccountId) ?? null) : null;
  const built = buildJournalLinesForTransaction({ ...transaction, suggestedGlAccount: resolvedGlAccount, journalId: null }, bankAccount);
  if (!built.ok) {
    return { transactionId: transaction.id, matchedRuleIds: matchedRules.map((r) => r.id), autoPosted: false, journalId: null, exceptionsRaised };
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Bank Transaction Automation",
    description: `Automated from rule "${winningRule?.name ?? "unknown"}" — ${transaction.description}`,
    reference: transaction.reference,
    sourceType: "bank_transaction_rule_engine",
    sourceId: transaction.id,
    status: "Approved",
    lines: built.lines,
  });

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (wasPosted) {
    await explorerRepo.markTransactionPosted(companyId, transaction.id, journal.id);
  }

  return {
    transactionId: transaction.id,
    matchedRuleIds: matchedRules.map((r) => r.id),
    autoPosted: wasPosted,
    journalId: wasPosted ? journal.id : null,
    exceptionsRaised,
  };
}

export type RuleEngineRunOutcome = {
  processed: number;
  autoPosted: number;
  exceptionsRaised: number;
  results: TransactionProcessingResult[];
};

/** Runs every unprocessed transaction through the pipeline, plus a
 * batch-level Banking Intelligence pass (duplicate/large-unusual-payment
 * detection needs the whole set, not one transaction at a time) that
 * raises its own exceptions independently of rule matching. */
export async function runRuleEngine(companyId: string, performedBy = "System"): Promise<RuleEngineRunOutcome> {
  const [activeRules, transactions] = await Promise.all([ruleRepo.listActiveBankingRules(companyId, "Banking"), explorerRepo.listUnprocessedTransactions(companyId)]);

  const bankAccountIds = [...new Set(transactions.map((t) => t.bankAccountId).filter((id): id is number => id !== null))];
  const bankAccounts = await Promise.all(bankAccountIds.map((id) => bankAccountRepo.getBankAccount(companyId, id)));
  const bankAccountsById = new Map<number, BankAccountGlInfo>();
  bankAccounts.forEach((account) => {
    if (account) bankAccountsById.set(account.id, { glAccount: account.glAccount, accountNumber: account.accountNumber });
  });

  const results: TransactionProcessingResult[] = [];
  for (const transaction of transactions) {
    results.push(await processTransaction(companyId, transaction, activeRules, bankAccountsById, performedBy));
  }

  await raiseIntelligenceExceptions(companyId, transactions);

  return {
    processed: results.length,
    autoPosted: results.filter((r) => r.autoPosted).length,
    exceptionsRaised: results.reduce((sum, r) => sum + r.exceptionsRaised.length, 0),
    results,
  };
}

/** Manual counterpart to `runRuleEngine` for the "Apply Rule" bulk
 * action — same pipeline, restricted to an explicit selection. */
export async function applyRulesToTransactions(companyId: string, transactionIds: number[], performedBy: string): Promise<TransactionProcessingResult[]> {
  const [activeRules, transactions] = await Promise.all([ruleRepo.listActiveBankingRules(companyId, "Banking"), explorerRepo.getTransactionsByIds(companyId, transactionIds)]);

  const bankAccountIds = [...new Set(transactions.map((t) => t.bankAccountId).filter((id): id is number => id !== null))];
  const bankAccounts = await Promise.all(bankAccountIds.map((id) => bankAccountRepo.getBankAccount(companyId, id)));
  const bankAccountsById = new Map<number, BankAccountGlInfo>();
  bankAccounts.forEach((account) => {
    if (account) bankAccountsById.set(account.id, { glAccount: account.glAccount, accountNumber: account.accountNumber });
  });

  const results: TransactionProcessingResult[] = [];
  for (const transaction of transactions) {
    results.push(await processTransaction(companyId, transaction, activeRules, bankAccountsById, performedBy));
  }
  return results;
}

async function raiseIntelligenceExceptions(companyId: string, transactions: BankTransactionRecord[]): Promise<void> {
  const intelligenceInput: IntelligenceTransaction[] = transactions.map((t) => ({
    id: t.id,
    transactionDate: t.transactionDate,
    beneficiary: t.beneficiary,
    debit: t.debit,
    credit: t.credit,
  }));
  const signalsByTransaction = buildBankingIntelligence(intelligenceInput, LARGE_PAYMENT_THRESHOLD);

  for (const [transactionId, signals] of signalsByTransaction) {
    for (const signal of signals) {
      if (signal.kind === "duplicate-payment") {
        await exceptionRepo.raiseExceptionIdempotent(companyId, {
          bankTransactionId: transactionId,
          exceptionType: "PossibleDuplicate",
          reason: signal.message,
          evidence: signal.reasoning,
          recommendedAction: signal.suggestedAction,
        });
      } else if (signal.kind === "suspicious-pattern") {
        await exceptionRepo.raiseExceptionIdempotent(companyId, {
          bankTransactionId: transactionId,
          exceptionType: "LargeUnusualPayment",
          reason: signal.message,
          evidence: signal.reasoning,
          recommendedAction: signal.suggestedAction,
        });
      }
    }
  }
}

export async function getOrCreateMerchantForTransaction(companyId: string, transaction: BankTransactionRecord) {
  return merchantRepo.getOrCreateMerchantByBeneficiary(companyId, transaction.beneficiary);
}
