/**
 * Post to Accounting — the step that takes a processed bank transaction
 * into the General Ledger, and the missing link in the banking workflow:
 *
 *   IMPORT -> EXPLORER -> CLASSIFY -> **POST** -> GL -> REPORTS -> RECONCILE
 *
 * Before this existed, Transaction Explorer could assign a GL account to
 * a transaction and stop there. Assigning an account says where a
 * transaction belongs; it does not move the ledger, and nothing further
 * downstream — Trial Balance, Income Statement, Balance Sheet, the bank
 * reconciliation's GL side — could see the transaction at all. This
 * module closes that gap using the accounting architecture already in
 * place rather than a parallel one:
 *
 *   `journal-service.ts::buildJournalLinesForTransaction` builds the
 *   double entry (already exhaustively unit tested, VAT-aware,
 *   split-aware) -> `ae_journals`/`ae_journal_lines` hold it ->
 *   `gl_transactions` is the ledger -> `posting_batches` records the run.
 *
 * Three things are genuinely new here, and each is deliberate:
 *
 * 1. ONE JOURNAL PER TRANSACTION DATE. `gl_transactions.posting_date` and
 *    the financial period are taken from the journal's date. A single
 *    journal covering a six-month migration would post every line into
 *    whichever period the posting run happened to fall in, silently
 *    misstating every prior period. Grouping by the transaction's own
 *    date is the only way the resulting Trial Balance is true.
 *
 * 2. THE JOURNAL IS CREATED ALREADY APPROVED. A bank transaction is a
 *    source document that the accountant has already reviewed and
 *    classified in the Explorer — the approval decision happens there,
 *    when they press Post, not again on a journal they never typed.
 *    `journal-workflow-service.ts::reverseJournal` established this same
 *    create-Approved precedent. Manual journals keep their full
 *    Draft -> Submitted -> Approved -> Posted workflow, untouched.
 *
 * 3. POSTING IS ATOMIC AND CLAIM-GUARDED. `fn_post_bank_transactions`
 *    (migration 0092) claims each transaction with
 *    `posted_flag = false and journal_id is null` before writing
 *    anything, so the same transaction can never be posted twice — not by
 *    a double-click, not by two accountants, not by a retry. Migration
 *    0100 adds the case those two flags cannot see: a transaction a live
 *    Banking Rule journal already carries into the ledger is neither
 *    planned here nor claimed by the database.
 *
 * What this module never does is change the client's figures. A
 * transaction that cannot be posted is reported back with the reason and
 * left exactly as it was; nothing is rounded, merged, corrected or
 * quietly dropped to make a batch succeed.
 */

import * as repo from "@/server/repositories/transaction-explorer-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as postingRepo from "@/server/repositories/posting-repository";
import * as splitRepo from "@/server/repositories/bank-transaction-split-repository";
import * as chartOfAccountsRepo from "@/server/repositories/chart-of-accounts-repository";
import * as financialYearRepo from "@/server/repositories/financial-year-repository";
import { getCompany } from "@/server/repositories/company-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { checkPostingDate } from "@/server/services/financial-period-service";
import { computeFinancialPeriod, computeFinancialYearLabel } from "@/server/services/financial-year-service";
import { buildJournalLinesForSplitTransaction, buildJournalLinesForTransaction, type BankAccountGlInfo, type LedgerControlAccounts } from "@/server/services/journal-service";
import * as postingRuleRepo from "@/server/repositories/posting-rule-repository";
import {
  isLiveRuleEngineJournal,
  satisfiesSupplierInvoiceMatching,
  transactionPostingStatus,
  SUPPLIER_INVOICE_MATCHING_REQUIRED_REASON,
  type BankTransactionRecord,
  type RuleEngineJournalRef,
} from "@/server/accounting/types";
import type { PostingBatch } from "@/server/general-ledger/types";

export class ValidationError extends Error {}

const BALANCE_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A journal line that still remembers which bank transaction produced
 * it. The link is what makes partial posting safe: the database filters
 * lines down to the transactions it actually claimed, and because every
 * transaction contributes its own self-balancing group of lines, dropping
 * one transaction's whole group can never unbalance what remains. */
export type TaggedJournalLine = {
  transactionId: number;
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
};

export type PlannedJournal = {
  journalNumber: string;
  journalDate: string;
  journalType: string;
  description: string;
  reference: string;
  financialYearLabel: string;
  financialPeriod: number;
  transactionIds: number[];
  lines: TaggedJournalLine[];
};

/** A transaction that will not be posted, and the honest reason why —
 * never silently dropped from the batch. `alreadyPosted` is separated
 * from `notReady` because they mean different things to the accountant:
 * one is a no-op, the other is work still to do. */
export type PostingExclusion = {
  transactionId: number;
  reason: string;
  kind: "already-posted" | "not-ready" | "blocked";
};

export type BankPostingPlan = {
  journals: PlannedJournal[];
  alreadyPosted: PostingExclusion[];
  notReady: PostingExclusion[];
  blocked: PostingExclusion[];
};

export type PostingPlanContext = {
  bankAccountsById: Map<number, BankAccountGlInfo>;
  /** The Creditors/Debtors control accounts this company's own posting
   * rules name — the destination for a payment allocated to a supplier
   * or a receipt allocated to a customer, which has no GL account of its
   * own. Never defaulted to a hardcoded code: a company with no such
   * rule gets a "not configured" reason, not a guessed ledger entry. */
  controlAccounts: LedgerControlAccounts;
  splitsByTransactionId: Map<number, { amount: number; description: string; glAccount: string }[]>;
  accountCodes: Set<string>;
  financialYears: Parameters<typeof checkPostingDate>[0];
  financialYearStartMonth: number;
  /** Journal numbers are handed in rather than generated here so this
   * function stays pure and independently testable — the caller reserves
   * a contiguous block from `nextJournalNumber`. */
  journalNumberAt: (index: number) => string;
  /** Migration 0100 — each selected transaction's Banking Rule journal, if
   * it has one. A live one means the amount is already in (or on its way
   * to) the ledger even when the transaction's own `posted_flag` and
   * `journal_id` were never stamped. Omitted = none. */
  ruleEngineJournalsByTransactionId?: Map<number, RuleEngineJournalRef>;
};

/** Why a transaction that a live Banking Rule journal covers is not
 * posted again — or `null` when no such journal exists. */
export function ruleEngineJournalExclusion(transactionId: number, journal: RuleEngineJournalRef | undefined): PostingExclusion | null {
  if (!journal || !isLiveRuleEngineJournal(journal)) return null;
  if (journal.status === "Posted") {
    return {
      transactionId,
      reason: `Already posted to the General Ledger by Banking Rule journal ${journal.journalNumber}. Its link to this transaction is restored automatically by the Banking Rules sweep — do not post it again.`,
      kind: "already-posted",
    };
  }
  return {
    transactionId,
    reason: `Banking Rule journal ${journal.journalNumber} (${journal.status}) already covers this transaction — post or cancel that journal instead of posting the transaction again.`,
    kind: "blocked",
  };
}

/**
 * Pure. The whole decision of what gets posted, how it is grouped, and
 * what does not get posted and why — no Supabase, so the accounting
 * judgement can be tested exhaustively on its own.
 *
 * Every reason a transaction can be excluded is surfaced, in the category
 * the accountant needs to act on:
 *   already-posted — nothing to do, it is already in the ledger
 *   not-ready      — real work outstanding (no GL account, no amount)
 *   blocked        — configuration or period problem stopping an
 *                    otherwise-ready transaction (bank account has no GL
 *                    account, closed financial period, unknown account
 *                    code)
 */
export function buildBankPostingPlan(transactions: BankTransactionRecord[], context: PostingPlanContext): BankPostingPlan {
  const alreadyPosted: PostingExclusion[] = [];
  const notReady: PostingExclusion[] = [];
  const blocked: PostingExclusion[] = [];

  // Grouped by transaction date, and kept in ascending date order so a
  // migration's journals read chronologically in the Journals list.
  const byDate = new Map<string, { transactionIds: number[]; lines: TaggedJournalLine[] }>();

  for (const txn of transactions) {
    const status = transactionPostingStatus(txn);
    if (status === "Posted" || status === "Reconciled") {
      alreadyPosted.push({ transactionId: txn.id, reason: `Already posted to the General Ledger${txn.postingBatchId ? ` in batch ${txn.postingBatchId}` : ""}.`, kind: "already-posted" });
      continue;
    }
    if (txn.journalId !== null) {
      blocked.push({ transactionId: txn.id, reason: "Already attached to journal — review that journal instead of posting this transaction again.", kind: "blocked" });
      continue;
    }
    const ruleEngineExclusion = ruleEngineJournalExclusion(txn.id, context.ruleEngineJournalsByTransactionId?.get(txn.id));
    if (ruleEngineExclusion) {
      (ruleEngineExclusion.kind === "already-posted" ? alreadyPosted : blocked).push(ruleEngineExclusion);
      continue;
    }
    if (!txn.transactionDate) {
      blocked.push({ transactionId: txn.id, reason: "No transaction date — a journal cannot be dated, so it cannot be assigned to a financial period.", kind: "blocked" });
      continue;
    }
    if (status === "Unprocessed") {
      notReady.push({ transactionId: txn.id, reason: "Not classified yet — assign a GL account (or split it) before posting.", kind: "not-ready" });
      continue;
    }

    const dateCheck = checkPostingDate(context.financialYears, txn.transactionDate);
    if (!dateCheck.ok) {
      blocked.push({ transactionId: txn.id, reason: dateCheck.reason, kind: "blocked" });
      continue;
    }

    // Supplier invoice matching. A supplier payment is expected to settle
    // an invoice VYRON can point at; when it genuinely does not, the
    // accountant says so explicitly with the override rather than being
    // stuck. Never silently skipped — the reason names both ways out.
    if (!satisfiesSupplierInvoiceMatching(txn)) {
      blocked.push({ transactionId: txn.id, reason: SUPPLIER_INVOICE_MATCHING_REQUIRED_REASON, kind: "blocked" });
      continue;
    }

    const bankAccount = txn.bankAccountId !== null ? (context.bankAccountsById.get(txn.bankAccountId) ?? null) : null;
    const built = txn.isSplit
      ? buildJournalLinesForSplitTransaction(txn, context.splitsByTransactionId.get(txn.id) ?? [], bankAccount)
      : buildJournalLinesForTransaction(txn, bankAccount, context.controlAccounts);
    if (!built.ok) {
      // `buildJournalLinesForTransaction`'s own reasons already
      // distinguish "you haven't finished classifying this" from "the
      // bank account is misconfigured"; both are things the accountant
      // must fix, and neither is a reason to alter the transaction.
      const kind = built.reason.startsWith("No GL account") ? "not-ready" : "blocked";
      (kind === "not-ready" ? notReady : blocked).push({ transactionId: txn.id, reason: built.reason, kind });
      continue;
    }

    const missingAccount = built.lines.find((line) => !context.accountCodes.has(line.accountCode));
    if (missingAccount) {
      blocked.push({
        transactionId: txn.id,
        reason: `No Chart of Accounts entry for account code "${missingAccount.accountCode}" — create it before posting.`,
        kind: "blocked",
      });
      continue;
    }

    const group = byDate.get(txn.transactionDate) ?? { transactionIds: [], lines: [] };
    group.transactionIds.push(txn.id);
    group.lines.push(...built.lines.map((line) => ({ transactionId: txn.id, ...line })));
    byDate.set(txn.transactionDate, group);
  }

  const journals: PlannedJournal[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([journalDate, group], index) => ({
      journalNumber: context.journalNumberAt(index),
      journalDate,
      journalType: "Bank Transactions",
      description: `Bank transactions posted for ${journalDate} (${group.transactionIds.length} transaction${group.transactionIds.length === 1 ? "" : "s"})`,
      reference: "",
      financialYearLabel: computeFinancialYearLabel(journalDate, context.financialYearStartMonth),
      financialPeriod: computeFinancialPeriod(journalDate, context.financialYearStartMonth),
      transactionIds: group.transactionIds,
      lines: group.lines,
    }));

  // Defensive: each transaction's lines balance by construction, so the
  // sum must too. A failure here would mean a bug in line building, and
  // posting an unbalanced journal would corrupt the ledger — so the whole
  // journal is refused rather than written.
  for (const journal of journals) {
    const debit = round2(journal.lines.reduce((sum, l) => sum + l.debit, 0));
    const credit = round2(journal.lines.reduce((sum, l) => sum + l.credit, 0));
    if (Math.abs(debit - credit) > BALANCE_TOLERANCE) {
      throw new ValidationError(`Journal for ${journal.journalDate} does not balance: debit ${debit} != credit ${credit}.`);
    }
  }

  return { journals, alreadyPosted, notReady, blocked };
}

export type PostBankTransactionsOutcome = {
  batch: PostingBatch | null;
  /** Transactions genuinely written to the ledger by this run. */
  posted: { transactionId: number; journalId: number; journalNumber: string }[];
  journals: { id: number; journalNumber: string; journalDate: string; transactionCount: number }[];
  alreadyPosted: PostingExclusion[];
  notReady: PostingExclusion[];
  blocked: PostingExclusion[];
};

/**
 * A read-only "what would happen if I pressed Post?" — the numbers behind
 * the button's own label and its confirmation dialog. Writes nothing, so
 * the accountant sees the blast radius (and every excluded transaction's
 * reason) before committing.
 */
export async function previewBankPosting(companyId: string, transactionIds: number[]): Promise<BankPostingPlan> {
  if (transactionIds.length === 0) throw new ValidationError("Select at least one transaction to post.");
  const { transactions, context } = await loadPostingContext(companyId, transactionIds);
  return buildBankPostingPlan(transactions, context);
}

/** The account code a posting rule's named role points at — e.g. the
 * `creditors` line of the seeded "Supplier Payment" rule. Returns null
 * (never a guess) when the company has no such rule or the role carries
 * no fixed account code, so the caller reports a configuration problem
 * instead of posting to an account nobody chose. */
export function controlAccountFromRule(rule: { lines: { role: string; fixedAccountCode: string | null }[] } | null, role: string): string | null {
  const line = rule?.lines.find((l) => l.role === role);
  const code = line?.fixedAccountCode?.trim();
  return code ? code : null;
}

async function loadPostingContext(companyId: string, transactionIds: number[]): Promise<{ transactions: BankTransactionRecord[]; context: PostingPlanContext }> {
  const transactions = await repo.getTransactionsByIds(companyId, transactionIds);

  const bankAccountIds = [...new Set(transactions.map((t) => t.bankAccountId).filter((id): id is number => id !== null))];
  const [bankAccounts, accounts, company, financialYears, journalNumberBase, supplierPaymentRule, customerReceiptRule, ruleEngineJournalsByTransactionId] = await Promise.all([
    Promise.all(bankAccountIds.map((id) => bankAccountRepo.getBankAccount(companyId, id))),
    chartOfAccountsRepo.listChartOfAccounts(companyId),
    getCompany(companyId),
    financialYearRepo.listFinancialYears(companyId),
    journalRepo.nextJournalNumber(companyId),
    postingRuleRepo.getPostingRuleByEventType(companyId, "Supplier Payment"),
    postingRuleRepo.getPostingRuleByEventType(companyId, "Customer Receipt"),
    journalRepo.listRuleEngineJournalsForTransactions(companyId, transactions.map((t) => t.id)),
  ]);

  // Read from the company's OWN rules (seeded by `seed_company_defaults()`
  // as DR creditors / CR bank and DR bank / CR debtors — migration 0007)
  // rather than hardcoding "2000"/"1100" here, so a company that has
  // re-mapped its control accounts posts to the accounts it actually uses.
  const controlAccounts: LedgerControlAccounts = {
    creditors: controlAccountFromRule(supplierPaymentRule, "creditors"),
    debtors: controlAccountFromRule(customerReceiptRule, "debtors"),
  };

  const bankAccountsById = new Map<number, BankAccountGlInfo>();
  bankAccounts.forEach((account) => {
    if (account) bankAccountsById.set(account.id, { glAccount: account.glAccount, accountNumber: account.accountNumber });
  });

  const splitsByTransactionId = new Map<number, { amount: number; description: string; glAccount: string }[]>();
  await Promise.all(
    transactions
      .filter((t) => t.isSplit)
      .map(async (t) => {
        const splits = await splitRepo.listSplitsForTransaction(companyId, t.id);
        splitsByTransactionId.set(
          t.id,
          splits.map((s) => ({ amount: s.amount, description: s.description, glAccount: s.glAccount })),
        );
      }),
  );

  // `nextJournalNumber` returns e.g. "JR000042"; this run needs a
  // contiguous block from there, one per date. The unique
  // `(company_id, journal_number)` constraint is the race backstop, the
  // same one `nextJournalNumber` itself relies on.
  const baseNumber = Number(journalNumberBase.replace(/\D/g, "")) || 1;

  return {
    transactions,
    context: {
      bankAccountsById,
      controlAccounts,
      splitsByTransactionId,
      accountCodes: new Set(accounts.map((a) => a.accountCode)),
      financialYears,
      financialYearStartMonth: company?.financialYearStartMonth ?? 3,
      journalNumberAt: (index) => `JR${String(baseNumber + index).padStart(6, "0")}`,
      ruleEngineJournalsByTransactionId,
    },
  };
}

/**
 * Posts the selected transactions. Everything postable in the selection
 * is posted; everything that is not is reported with its reason. One bad
 * transaction never blocks the rest of the batch — the same
 * skip-and-report discipline `postApprovedJournals` uses.
 */
export async function postBankTransactions(companyId: string, transactionIds: number[]): Promise<PostBankTransactionsOutcome> {
  if (transactionIds.length === 0) throw new ValidationError("Select at least one transaction to post.");

  const { transactions, context } = await loadPostingContext(companyId, transactionIds);
  const plan = buildBankPostingPlan(transactions, context);

  if (plan.journals.length === 0) {
    return { batch: null, posted: [], journals: [], alreadyPosted: plan.alreadyPosted, notReady: plan.notReady, blocked: plan.blocked };
  }

  const performedBy = await getPerformedByLabel();
  const batchNumber = await postingRepo.nextPostingBatchNumber(companyId);
  const postingDate = new Date().toISOString().slice(0, 10);
  const claimableIds = plan.journals.flatMap((j) => j.transactionIds);

  const result = await postingRepo.postBankTransactionsAtomic(companyId, claimableIds, plan.journals, batchNumber, postingDate, performedBy);

  // The database is authoritative about what it actually claimed. A
  // transaction this call planned to post but a concurrent run claimed
  // first is reported as already posted, not counted as a success.
  const postedByTransactionId = new Map<number, { journalId: number; journalNumber: string }>();
  for (const journal of result.journals) {
    for (const transactionId of journal.transactionIds) {
      postedByTransactionId.set(transactionId, { journalId: journal.id, journalNumber: journal.journalNumber });
    }
  }

  const posted = [...postedByTransactionId.entries()].map(([transactionId, j]) => ({ transactionId, ...j }));
  const lostToConcurrentRun: PostingExclusion[] = claimableIds
    .filter((id) => !postedByTransactionId.has(id))
    .map((id) => ({ transactionId: id, reason: "Posted by another posting run while this one was in progress.", kind: "already-posted" as const }));

  return {
    batch: result.batch,
    posted,
    journals: result.journals.map((j) => ({ id: j.id, journalNumber: j.journalNumber, journalDate: j.journalDate, transactionCount: j.transactionIds.length })),
    alreadyPosted: [...plan.alreadyPosted, ...lostToConcurrentRun],
    notReady: plan.notReady,
    blocked: plan.blocked,
  };
}
