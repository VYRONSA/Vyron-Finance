/**
 * The Rule Engine's real orchestration — Business Event (a bank
 * transaction) -> Rule Engine (`evaluateTransactionAgainstRules`) ->
 * Posting -> General Ledger, exactly the pipeline the Product Review
 * Board's brief describes, with no alternative workflow introduced:
 * journal LINE building reuses
 * `journal-service.ts::buildJournalLinesForTransaction` (the exact same
 * pure function Transaction Explorer's existing manual "Generate
 * Journal" bulk action calls). A Bank Fee / Interest rule reaches the
 * ledger by resolving its GL action to the SAME account code (6100 /
 * 6200) the already-existing 'Bank Charges' / 'Interest Received' posting
 * rules use — no new posting-rule row is ever created for it.
 *
 * "Unknown transactions should become the exception — not the normal
 * workflow": a transaction with no rule match and no existing
 * Matching-Engine supplier match becomes an `UnknownMerchant` exception,
 * not a silently-skipped row.
 *
 * Migration 0100 — posting is ONE database call
 * (`fn_post_rule_engine_journal`): journal, lines, posting batch, GL rows
 * and the transaction's own link commit together or not at all. It used
 * to be `createJournal` -> `postApprovedJournals` (every Approved journal
 * in the company) -> `markTransactionPosted`; when the cron request was
 * killed between the last two, production transaction 2151 was left with
 * a Posted journal (JR000264) but no link. Any transaction already in that
 * state is recovered FIRST — before rule matching, whose claim guard would
 * otherwise turn it away — by linking it to its existing journal, never by
 * posting it again. The rule's claim on a transaction it posts is part of
 * the same call, so a failed post never leaves a rule-owned, unposted
 * transaction behind.
 */

import * as explorerRepo from "@/server/repositories/transaction-explorer-repository";
import { buildRuleClaim, type RuleResolutionFields } from "@/server/repositories/transaction-explorer-repository";
import * as ruleRepo from "@/server/repositories/banking-rule-repository";
import * as exceptionRepo from "@/server/repositories/banking-exception-repository";
import * as merchantRepo from "@/server/repositories/merchant-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as postingRepo from "@/server/repositories/posting-repository";
import * as financialYearRepo from "@/server/repositories/financial-year-repository";
import * as chartOfAccountsRepo from "@/server/repositories/chart-of-accounts-repository";
import { getCompany } from "@/server/repositories/company-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { checkPostingDate } from "@/server/services/financial-period-service";
import { computeFinancialPeriod, computeFinancialYearLabel } from "@/server/services/financial-year-service";
import { buildJournalLinesForTransaction, type BankAccountGlInfo } from "@/server/services/journal-service";
import { evaluateTransactionAgainstRules, type EvaluableTransaction } from "@/server/banking-rules/rule-engine";
import { buildBankingIntelligence, type IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";
import type { BankingRule } from "@/server/banking-rules/types";
import type { BankTransactionRecord, RuleEngineJournalRef } from "@/server/accounting/types";
import type { FinancialYear } from "@/server/company-management/types";

const LARGE_PAYMENT_THRESHOLD = 50_000;

/** A sweep stops starting new work once this much time has passed
 * (unless the caller sets its own deadline). Well inside the 300-second
 * platform limit; each transaction is atomic, so even a hard kill cannot
 * leave one half-posted. */
export const DEFAULT_RULE_ENGINE_BUDGET_MS = 120_000;

/** At most this many posting/recovery database calls per sweep; the rest
 * wait for the next run. Transactions no rule matches never count. */
export const DEFAULT_RULE_ENGINE_MAX_POSTINGS = 150;

export function toEvaluable(t: BankTransactionRecord): EvaluableTransaction {
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
    // Finding #005 (RC unassigned, standalone) — `CONDITION_FIELDS`
    // (the UI's own condition-field vocabulary, `types.ts`) spells these
    // two snake_case ("bank_account"/"gl_account"); every other field
    // resolves fine since its UI spelling and this record's key happen
    // to agree. Aliased here rather than renaming `CONDITION_FIELDS` —
    // a rename would silently orphan any rule already saved with the
    // snake_case field name (the DB column is free text, no migration
    // path exists to rewrite it).
    bank_account: t.bankAccount,
    gl_account: t.glAccount,
  };
}

/** The in-memory twin of migration 0100's `fn_bank_transaction_is_claimable_by_rule`
 * (the guard `applyRuleActions` and the atomic posting call enforce):
 * whether a Banking Rule may still take this transaction. The database
 * stays authoritative; this only lets a sweep skip rows it would certainly
 * refuse (and order its work) without a round trip each. Manual Cashbook
 * entries are never a rule's to take — they are approved and posted from
 * the Cashbook. */
/** A transaction a Banking Rule already owns (`rule_id` set) that has no
 * journal and is not flagged posted. Two kinds exist, and neither is ever
 * posted — or "retried" — by the Rule Engine; both wait for a person
 * (Transaction Explorer / Bank Posting):
 *
 *   - LEGACY rows: classified by a rule before rules posted automatically
 *     (production Northwood has about 562 such rows with a GL account,
 *     classified 21 Aug – 9 Sep 2026). Auto-posting them is an accounting
 *     decision that has not been approved.
 *   - rows a rule only classified under this code: a flag-for-review rule,
 *     a rule without a GL account, or journal lines that cannot be built.
 *
 * The Rule Engine's retry covers ONLY its own atomic claim + post
 * (`fn_post_rule_engine_journal`): when that call fails, the claim is rolled
 * back with everything else, so the transaction is still unclaimed — never
 * in this state — and the next sweep evaluates it again. A rule-owned
 * transaction whose Banking Rule journal DOES exist (the 2151 shape) is a
 * recovery (link only), handled before this check. */
export function isRuleOwnedAwaitingReview(t: Pick<BankTransactionRecord, "journalId" | "ruleId" | "postedFlag">): boolean {
  return t.journalId === null && t.ruleId !== null && !t.postedFlag;
}

export function isClaimableByRule(
  t: Pick<
    BankTransactionRecord,
    "journalId" | "isManualOverride" | "ruleId" | "matchedSupplierId" | "matchedCustomerId" | "matchedMerchantId" | "reviewHold" | "allocationStatus" | "suggestedGlAccount" | "allocationMethod" | "entrySource"
  >,
): boolean {
  if (t.journalId !== null || t.isManualOverride || t.reviewHold) return false;
  if (t.entrySource === "Manual") return false;
  if (t.ruleId !== null || t.matchedSupplierId !== null || t.matchedCustomerId !== null || t.matchedMerchantId !== null) return false;
  return (t.allocationStatus === "Unallocated" && t.suggestedGlAccount === null) || t.allocationMethod === "Future AI";
}

export type TransactionProcessingResult = {
  transactionId: number;
  matchedRuleIds: number[];
  autoPosted: boolean;
  journalId: number | null;
  exceptionsRaised: string[];
  /** Migration 0100 — a missing link to an existing Posted Banking Rule
   * journal was restored; nothing was posted. */
  recovered?: boolean;
  /** Why a transaction the rules resolved was not posted (closed period,
   * unknown account, an existing journal that is not safe to link...). */
  notPostedReason?: string;
  /** A posting/recovery call failed outright (database unavailable...).
   * Nothing was written for this transaction. */
  postingError?: string;
  /** A posting or recovery database call was made — what a sweep's
   * `maxPostings` limits. */
  postingAttempted?: boolean;
  /** A rule already owns this transaction but nothing posted it (legacy or
   * classification-only): left for a person, never posted automatically. */
  awaitingReview?: boolean;
};

/** Everything posting needs that is the same for every transaction in a run. */
export type RuleEnginePostingContext = {
  financialYears: FinancialYear[];
  financialYearStartMonth: number;
  accountCodes: Set<string>;
  postedBy: string;
};

export type ProcessTransactionOptions = {
  /** This transaction's Banking Rule journal, if the caller already
   * looked it up (`null` = known to have none). Omitted = look it up. */
  ruleEngineJournal?: RuleEngineJournalRef | null;
  postingContext?: RuleEnginePostingContext;
  /** `false`: never claim or post — only recover or raise exceptions (a
   * sweep's unbudgeted pass). Default `true`. */
  mayClaim?: boolean;
  /** The caller already knows an Open UnknownMerchant exception exists, so
   * raising it again (a guaranteed no-op) is skipped. */
  hasOpenUnknownMerchantException?: boolean;
  /** Test seam for the run date. Default: today's UTC date, as always. */
  today?: () => string;
};

export async function loadRuleEnginePostingContext(companyId: string): Promise<RuleEnginePostingContext> {
  const [financialYears, company, accounts, postedBy] = await Promise.all([
    financialYearRepo.listFinancialYears(companyId),
    getCompany(companyId),
    chartOfAccountsRepo.listChartOfAccounts(companyId),
    getPerformedByLabel(),
  ]);
  return {
    financialYears,
    financialYearStartMonth: company?.financialYearStartMonth ?? 3,
    accountCodes: new Set(accounts.map((a) => a.accountCode)),
    postedBy,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** The database's own validation refusals (migration 0100) — a property of
 * this transaction's data, not an outage. */
function isPostingValidationError(message: string): boolean {
  return message.includes("VYRON_RULE_POST_") || message.includes("VYRON_RULE_CLAIM_") || message.includes("VYRON_RULE_ENGINE_JOURNAL_EXISTS");
}

/** Recovery path: the transaction already has a Banking Rule journal. It is
 * never posted again; at most its missing link is restored. */
async function resolveExistingJournal(
  companyId: string,
  transaction: BankTransactionRecord,
  existing: RuleEngineJournalRef,
  performedBy: string,
): Promise<TransactionProcessingResult> {
  const base = { transactionId: transaction.id, matchedRuleIds: [], autoPosted: false, exceptionsRaised: [] };
  if (existing.status !== "Posted" || existing.isReversed) {
    const state = existing.isReversed ? "reversed" : existing.status;
    return { ...base, journalId: null, notPostedReason: `Banking Rule journal ${existing.journalNumber} already exists for this transaction (${state}); it is not posted again.` };
  }
  // The same two states `fn_recover_rule_engine_journal_link` refuses —
  // answered here without a database call.
  if (transaction.postedFlag) {
    return { ...base, journalId: null, notPostedReason: `Banking Rule journal ${existing.journalNumber} exists, but the transaction is already flagged posted without a journal link; it needs a person to review it.` };
  }
  if (transaction.reconciliationId !== null) {
    return { ...base, journalId: null, notPostedReason: `Banking Rule journal ${existing.journalNumber} exists, but the transaction is reconciled; it needs a person to review it.` };
  }
  try {
    const outcome = await postingRepo.recoverRuleEngineJournalLink(companyId, transaction.id, performedBy);
    if (outcome.outcome === "recovered" || outcome.outcome === "already_linked") {
      return { ...base, journalId: outcome.journalId, recovered: outcome.outcome === "recovered", postingAttempted: true };
    }
    return { ...base, journalId: null, postingAttempted: true, notPostedReason: outcome.reason ?? `Existing Banking Rule journal could not be linked (${outcome.outcome}).` };
  } catch (err) {
    const message = errorMessage(err);
    return isPostingValidationError(message)
      ? { ...base, journalId: null, postingAttempted: true, notPostedReason: message }
      : { ...base, journalId: null, postingAttempted: true, postingError: message };
  }
}

/** One transaction through the pipeline. Never throws for a single bad
 * transaction — a failure is reported on the result (`notPostedReason` /
 * `postingError`).
 *
 * Migration 0100 — a transaction the rule will post is claimed INSIDE the
 * atomic posting call, so a posting failure (outage, refusal, a date or
 * account check) leaves it exactly as it was: still unclaimed, and the
 * next sweep evaluates and tries it again, once. A transaction the rule
 * only classifies (flagged for review, no GL account, or journal lines
 * that cannot be built — a supplier/customer allocation, a bank account
 * without a GL account) is claimed on its own as before and is not posted
 * by a later sweep; it waits for a person, like every rule-owned
 * transaction created before this change. */
export async function processTransaction(
  companyId: string,
  transaction: BankTransactionRecord,
  activeRules: BankingRule[],
  bankAccountsById: Map<number, BankAccountGlInfo>,
  performedBy: string,
  options: ProcessTransactionOptions = {},
): Promise<TransactionProcessingResult> {
  const exceptionsRaised: string[] = [];

  if (transaction.journalId !== null) {
    return { transactionId: transaction.id, matchedRuleIds: [], autoPosted: false, journalId: transaction.journalId, exceptionsRaised };
  }

  // Migration 0100 — checked BEFORE rule matching. A transaction whose
  // posting was interrupted after its journal committed already carries
  // `rule_id`, so the claim below would refuse it and the recovery would
  // never be reached.
  const existingJournal =
    options.ruleEngineJournal !== undefined
      ? options.ruleEngineJournal
      : ((await journalRepo.listRuleEngineJournalsForTransactions(companyId, [transaction.id])).get(transaction.id) ?? null);
  if (existingJournal) {
    return resolveExistingJournal(companyId, transaction, existingJournal, performedBy);
  }

  const { matchedRules, actions } = evaluateTransactionAgainstRules(toEvaluable(transaction), activeRules);

  if (matchedRules.length === 0 && transaction.matchedSupplierId === null && transaction.matchedCustomerId === null) {
    if (!options.hasOpenUnknownMerchantException) {
      await exceptionRepo.raiseExceptionIdempotent(companyId, {
        bankTransactionId: transaction.id,
        exceptionType: "UnknownMerchant",
        reason: `No banking rule matched, and no supplier/customer has been identified for "${transaction.beneficiary}".`,
        evidence: `Beneficiary: ${transaction.beneficiary}; Description: ${transaction.description}; Amount: ${(transaction.debit || transaction.credit).toFixed(2)}.`,
        recommendedAction: "Assign a Merchant, Supplier, or Customer, or create a rule that recognises this beneficiary.",
      });
    }
    exceptionsRaised.push("UnknownMerchant");
    return { transactionId: transaction.id, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised };
  }

  // Rule-owned without a journal (legacy, or classification-only): never
  // claimed again, never posted, never retried — it waits for a person.
  if (isRuleOwnedAwaitingReview(transaction)) {
    return { transactionId: transaction.id, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised, awaitingReview: true };
  }

  // The claim would refuse this row (the Matching Engine or a person
  // already owns it, or it is a Manual Cashbook entry) — same answer, no
  // round trip. A sweep's unbudgeted pass never claims.
  if (!isClaimableByRule(transaction) || options.mayClaim === false) {
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
  const ruleName = winningRule?.name ?? "Unnamed rule";
  const matchedRuleIds = matchedRules.map((r) => r.id);
  const claimFields: RuleResolutionFields = {
    matchedMerchantId: resolvedMerchantId,
    matchedSupplierId: resolvedSupplierId,
    matchedCustomerId: resolvedCustomerId,
    suggestedGlAccount: resolvedGlAccount ?? undefined,
    suggestedVatCode: resolvedVatCode ?? undefined,
    ruleId: winningRule?.id,
    allocationStatus: resolvedSupplierId !== undefined || resolvedCustomerId !== undefined ? "Allocated" : "Suggested",
  };

  const result = (fields: Partial<TransactionProcessingResult>): TransactionProcessingResult => ({
    transactionId: transaction.id,
    matchedRuleIds,
    autoPosted: false,
    journalId: null,
    exceptionsRaised,
    ...fields,
  });
  // Phase 25K — lost the race: another process posted this transaction (or
  // a person recoded it) between this pass reading it and this write. Never
  // record a rule application or create a journal for a transaction this
  // pass no longer owns.
  const lostRace = (fields: Partial<TransactionProcessingResult> = {}) => result({ matchedRuleIds: [], ...fields });

  /** Classification only (no posting): the claim, its history and the rule
   * applications, in one database call. */
  const claimOnly = () => explorerRepo.applyRuleActions(companyId, transaction.id, claimFields, ruleName, performedBy, matchedRuleIds);

  if (flaggedReason) {
    if (!(await claimOnly())) return lostRace();
    await exceptionRepo.raiseExceptionIdempotent(companyId, {
      bankTransactionId: transaction.id,
      exceptionType: "UnbalancedAllocation",
      reason: flaggedReason,
      evidence: `Flagged by rule "${winningRule?.name ?? "unknown"}".`,
      recommendedAction: "Review this transaction manually before it is posted.",
    });
    exceptionsRaised.push("UnbalancedAllocation");
    return result({});
  }

  if (!resolvedGlAccount) {
    return (await claimOnly()) ? result({}) : lostRace();
  }

  const bankAccount = transaction.bankAccountId !== null ? (bankAccountsById.get(transaction.bankAccountId) ?? null) : null;
  const built = buildJournalLinesForTransaction({ ...transaction, suggestedGlAccount: resolvedGlAccount, journalId: null }, bankAccount);
  if (!built.ok) {
    return (await claimOnly()) ? result({ notPostedReason: built.reason }) : lostRace();
  }

  // From here on nothing is written unless the atomic call succeeds, so
  // every early return leaves the transaction open for the next sweep.
  let context: RuleEnginePostingContext;
  try {
    context = options.postingContext ?? (await loadRuleEnginePostingContext(companyId));
  } catch (err) {
    return result({ postingError: errorMessage(err) });
  }

  // Unchanged accounting: dated the day the rule posts it (what
  // `createJournal` defaulted to), the posting batch carries the same date
  // (what `postApprovedJournals` used), same period rules and account
  // checks. A journal that fails them is simply not created.
  const journalDate = options.today ? options.today() : new Date().toISOString().slice(0, 10);
  const dateCheck = checkPostingDate(context.financialYears, journalDate);
  if (!dateCheck.ok) return result({ notPostedReason: dateCheck.reason });
  const missingAccount = built.lines.find((line) => !context.accountCodes.has(line.accountCode));
  if (missingAccount) return result({ notPostedReason: `No Chart of Accounts entry for account code "${missingAccount.accountCode}".` });

  try {
    const outcome = await postingRepo.postRuleEngineJournalAtomic(
      companyId,
      transaction.id,
      {
        journalDate,
        journalType: "Bank Transaction Automation",
        description: `Automated from rule "${winningRule?.name ?? "unknown"}" — ${transaction.description}`,
        reference: transaction.reference,
        financialYearLabel: computeFinancialYearLabel(journalDate, context.financialYearStartMonth),
        financialPeriod: computeFinancialPeriod(journalDate, context.financialYearStartMonth),
        lines: built.lines,
      },
      context.postedBy,
      journalDate,
      buildRuleClaim(claimFields, ruleName, matchedRuleIds, performedBy),
    );
    switch (outcome.outcome) {
      case "posted":
        return result({ autoPosted: true, journalId: outcome.journalId, postingAttempted: true });
      case "recovered":
      case "already_linked":
        // Another worker got there first; this call only linked (or found
        // linked) that worker's journal and claimed nothing.
        return lostRace({ journalId: outcome.journalId, recovered: outcome.outcome === "recovered", postingAttempted: true });
      default:
        return lostRace({ postingAttempted: true, notPostedReason: outcome.reason ?? `Not posted (${outcome.outcome}).` });
    }
  } catch (err) {
    const message = errorMessage(err);
    if (isPostingValidationError(message)) return lostRace({ postingAttempted: true, notPostedReason: message });
    return lostRace({ postingAttempted: true, postingError: message });
  }
}

export type RuleEngineRunOptions = {
  /** Epoch ms after which no new transaction (or page) is started. */
  deadlineAtMs?: number;
  /** Most posting/recovery database calls in this run. */
  maxPostings?: number;
  /** Worklist page size (at most the API's 1,000-row limit). */
  pageSize?: number;
  /** Test seam for the clock. */
  now?: () => number;
};

export type RuleEngineRunOutcome = {
  processed: number;
  autoPosted: number;
  exceptionsRaised: number;
  /** Missing links to existing Posted journals restored this run. */
  recovered: number;
  /** Transactions the rules resolved but that were not posted, with a reason. */
  notPosted: number;
  /** Posting/recovery calls that failed outright. */
  postingErrors: number;
  /** Posting/recovery database calls made (what `maxPostings` limits). */
  postingAttempts: number;
  /** Rule-owned transactions without a journal this run saw and left for a
   * person (see `isRuleOwnedAwaitingReview`). Never posted automatically. */
  awaitingReview: number;
  /** Worklist transactions this run did not reach. */
  remaining: number;
  /** The run stopped before the end of its worklist. */
  stoppedEarly: boolean;
  stopReason: "time-budget" | "posting-limit" | null;
  /** The batch-level duplicate/large-payment pass was left for a later run. */
  intelligenceSkipped: boolean;
  results: TransactionProcessingResult[];
};

export const DEFAULT_RULE_ENGINE_PAGE_SIZE = 500;

/** The batch-level Banking Intelligence pass looks at the newest this-many
 * worklist rows, as it always did (the old worklist query's row limit). */
const INTELLIGENCE_WINDOW = 1000;

type PreparedRun = {
  activeRules: BankingRule[];
  bankAccountsById: Map<number, BankAccountGlInfo>;
  journalsByTransactionId: Map<number, RuleEngineJournalRef>;
  postingContext: RuleEnginePostingContext;
};

async function loadBankAccounts(companyId: string, transactions: BankTransactionRecord[], into: Map<number, BankAccountGlInfo>, missing: Set<number>): Promise<void> {
  const ids = [...new Set(transactions.map((t) => t.bankAccountId).filter((id): id is number => id !== null && !into.has(id) && !missing.has(id)))];
  const accounts = await Promise.all(ids.map((id) => bankAccountRepo.getBankAccount(companyId, id)));
  ids.forEach((id, index) => {
    const account = accounts[index];
    if (account) into.set(id, { glAccount: account.glAccount, accountNumber: account.accountNumber });
    else missing.add(id);
  });
}

async function prepareRun(companyId: string, transactions: BankTransactionRecord[], activeRules: BankingRule[]): Promise<PreparedRun> {
  const bankAccountsById = new Map<number, BankAccountGlInfo>();
  const [journalsByTransactionId, postingContext] = await Promise.all([
    journalRepo.listRuleEngineJournalsForTransactions(
      companyId,
      transactions.filter((t) => t.journalId === null).map((t) => t.id),
    ),
    loadRuleEnginePostingContext(companyId),
    loadBankAccounts(companyId, transactions, bankAccountsById, new Set()),
  ]);
  return { activeRules, bankAccountsById, journalsByTransactionId, postingContext };
}

function processPrepared(companyId: string, transaction: BankTransactionRecord, prepared: PreparedRun, performedBy: string): Promise<TransactionProcessingResult> {
  return processTransaction(companyId, transaction, prepared.activeRules, prepared.bankAccountsById, performedBy, {
    ruleEngineJournal: prepared.journalsByTransactionId.get(transaction.id) ?? null,
    postingContext: prepared.postingContext,
  });
}

/** Runs the unprocessed worklist through the pipeline, plus a batch-level
 * Banking Intelligence pass (duplicate/large-unusual-payment detection
 * needs the whole set, not one transaction at a time) that raises its own
 * exceptions independently of rule matching.
 *
 * Migration 0100 — bounded, and without starvation. Three passes:
 *
 *   1. Recoveries — transactions whose Posted Banking Rule journal lost
 *      its link (found directly, however long the worklist is).
 *   2. Claimable transactions a rule matches — the work that posts.
 *   3. Everything else — unmatched and rule-owned transactions (exceptions
 *      only; this pass never claims or posts).
 *
 * Only posting/recovery database calls count towards `maxPostings`, so
 * transactions no rule matches can never use up the budget and hide the
 * ones that do match. Each pass pages through the whole worklist with a
 * keyset cursor (the API returns at most 1,000 rows per request). The run
 * stops starting new work at its deadline and reports what it left; every
 * transaction is atomic, so stopping — or being killed — between two of
 * them is safe. A posted transaction drops out of the worklist; one that
 * could not be posted stays unclaimed and is tried again next run.
 *
 * Throws only when posting failed outright for every transaction it tried
 * and nothing was posted or recovered — a real outage, which the scheduler
 * then retries and, if it persists, suspends. */
export async function runRuleEngine(companyId: string, performedBy = "System", options: RuleEngineRunOptions = {}): Promise<RuleEngineRunOutcome> {
  const now = options.now ?? Date.now;
  const deadlineAtMs = options.deadlineAtMs ?? now() + DEFAULT_RULE_ENGINE_BUDGET_MS;
  const maxPostings = options.maxPostings ?? DEFAULT_RULE_ENGINE_MAX_POSTINGS;
  const pageSize = Math.max(1, Math.min(options.pageSize ?? DEFAULT_RULE_ENGINE_PAGE_SIZE, explorerRepo.RULE_ENGINE_WORKLIST_PAGE_MAX));

  const [activeRules, totalUnprocessed, postingContext] = await Promise.all([
    ruleRepo.listActiveBankingRules(companyId, "Banking"),
    explorerRepo.countUnprocessedTransactions(companyId),
    loadRuleEnginePostingContext(companyId),
  ]);
  const bankAccountsById = new Map<number, BankAccountGlInfo>();
  const missingBankAccounts = new Set<number>();

  const results: TransactionProcessingResult[] = [];
  const handled = new Set<number>();
  let postingAttempts = 0;
  let timeUp = false;
  let postingLimitReached = false;
  const outOfTime = () => {
    if (!timeUp && now() >= deadlineAtMs) timeUp = true;
    return timeUp;
  };
  const budgetLeft = () => {
    if (postingAttempts >= maxPostings) postingLimitReached = true;
    return !postingLimitReached;
  };
  const run = async (transaction: BankTransactionRecord, options: ProcessTransactionOptions) => {
    const outcome = await processTransaction(companyId, transaction, activeRules, bankAccountsById, performedBy, { postingContext, ...options });
    handled.add(transaction.id);
    results.push(outcome);
    if (outcome.postingAttempted) postingAttempts++;
  };

  // 1. Recoveries.
  if (!outOfTime() && budgetLeft()) {
    const candidates = await explorerRepo.listRuleEngineRecoveryCandidates(companyId, maxPostings - postingAttempts);
    const journals = await journalRepo.listRuleEngineJournalsForTransactions(companyId, candidates.map((t) => t.id));
    for (const transaction of candidates) {
      if (outOfTime() || !budgetLeft()) break;
      // A journal that vanished since the listing is not this pass's to post.
      await run(transaction, { ruleEngineJournal: journals.get(transaction.id) ?? null, mayClaim: false });
    }
    // A full page of candidates may mean more are waiting.
    if (candidates.length > 0 && candidates.length >= maxPostings) postingLimitReached = true;
  }

  // 2. Claimable transactions a rule matches.
  let after: explorerRepo.RuleEngineWorklistCursor | null = null;
  claimable: while (!outOfTime() && budgetLeft()) {
    const page = await explorerRepo.listRuleEngineWorklistPage(companyId, { claimableOnly: true, after, limit: pageSize });
    const matched = page.filter((t) => !handled.has(t.id) && evaluateTransactionAgainstRules(toEvaluable(t), activeRules).matchedRules.length > 0);
    if (matched.length > 0) {
      const [journals] = await Promise.all([
        journalRepo.listRuleEngineJournalsForTransactions(companyId, matched.map((t) => t.id)),
        loadBankAccounts(companyId, matched, bankAccountsById, missingBankAccounts),
      ]);
      for (const transaction of matched) {
        // A Banking Rule journal already exists: recovery's business
        // (pass 1), or reported by pass 3 — never posted again here.
        if (journals.has(transaction.id)) continue;
        if (outOfTime() || !budgetLeft()) break claimable;
        await run(transaction, { ruleEngineJournal: null });
      }
    }
    if (page.length < pageSize) break;
    after = explorerRepo.ruleEngineWorklistCursorAfter(page[page.length - 1]!);
  }

  // 3. Everything else (exceptions only).
  const intelligenceRows: IntelligenceTransaction[] = [];
  let restComplete = false;
  after = null;
  rest: while (!outOfTime()) {
    const page = await explorerRepo.listRuleEngineWorklistPage(companyId, { claimableOnly: false, after, limit: pageSize });
    for (const t of page) {
      if (intelligenceRows.length >= INTELLIGENCE_WINDOW) break;
      intelligenceRows.push({ id: t.id, transactionDate: t.transactionDate, beneficiary: t.beneficiary, debit: t.debit, credit: t.credit });
    }
    const pending = page.filter((t) => !handled.has(t.id));
    if (pending.length > 0) {
      const ids = pending.map((t) => t.id);
      const [journals, openUnknownMerchant] = await Promise.all([
        journalRepo.listRuleEngineJournalsForTransactions(companyId, ids),
        exceptionRepo.listTransactionIdsWithOpenException(companyId, "UnknownMerchant", ids),
      ]);
      for (const transaction of pending) {
        if (outOfTime()) break rest;
        const journal = journals.get(transaction.id) ?? null;
        // Budgeted work pass 1 or 2 had no budget (or time) left for — a
        // recoverable link, or a claimable transaction a rule matches: left
        // untouched for the next run and counted as remaining.
        if (journal && journal.status === "Posted" && !journal.isReversed && !transaction.postedFlag && transaction.reconciliationId === null) continue;
        if (!journal && isClaimableByRule(transaction) && evaluateTransactionAgainstRules(toEvaluable(transaction), activeRules).matchedRules.length > 0) continue;
        await run(transaction, { ruleEngineJournal: journal, mayClaim: false, hasOpenUnknownMerchantException: openUnknownMerchant.has(transaction.id) });
      }
    }
    if (page.length < pageSize) {
      restComplete = true;
      break;
    }
    after = explorerRepo.ruleEngineWorklistCursorAfter(page[page.length - 1]!);
  }

  let intelligenceSkipped = true;
  if (restComplete && !outOfTime()) {
    intelligenceSkipped = !(await raiseIntelligenceExceptions(companyId, intelligenceRows, () => now() < deadlineAtMs));
  }

  const autoPosted = results.filter((r) => r.autoPosted).length;
  const recovered = results.filter((r) => r.recovered).length;
  const postingErrors = results.filter((r) => r.postingError !== undefined);
  if (postingErrors.length > 0 && autoPosted === 0 && recovered === 0) {
    throw new Error(`Banking Rules could not post any transaction (${postingErrors.length} failed): ${postingErrors[0]!.postingError}`);
  }

  const stopReason: RuleEngineRunOutcome["stopReason"] = timeUp ? "time-budget" : postingLimitReached ? "posting-limit" : null;
  return {
    processed: results.length,
    autoPosted,
    exceptionsRaised: results.reduce((sum, r) => sum + r.exceptionsRaised.length, 0),
    recovered,
    notPosted: results.filter((r) => r.notPostedReason !== undefined).length,
    postingErrors: postingErrors.length,
    postingAttempts,
    awaitingReview: results.filter((r) => r.awaitingReview).length,
    remaining: stopReason === null ? 0 : Math.max(0, totalUnprocessed - handled.size),
    stoppedEarly: stopReason !== null,
    stopReason,
    intelligenceSkipped,
    results,
  };
}

/** Manual counterpart to `runRuleEngine` for the "Apply Rule" bulk
 * action — same pipeline, restricted to an explicit selection.
 *
 * Master Implementation Tracker — Programme 2, Epic E2, Finding #207.
 * `additionalRuleIds` lets a caller include a specific rule in THIS run
 * even if it's `isActive: false` (e.g. "Apply to Future Imports" was
 * left unticked when the rule was created inline) — "apply to the rest
 * of this statement, right now" and "keep matching every future
 * import" are two different questions; overloading one `isActive` flag
 * to answer both meant an inactive-by-design rule silently matched
 * nothing when applied to the rest of its own batch. Never changes the
 * rule's stored active state, only widens which rules this one
 * evaluation run considers. */
export async function applyRulesToTransactions(companyId: string, transactionIds: number[], performedBy: string, additionalRuleIds: number[] = []): Promise<TransactionProcessingResult[]> {
  const [listedRules, transactions] = await Promise.all([ruleRepo.listActiveBankingRules(companyId, "Banking"), explorerRepo.getTransactionsByIds(companyId, transactionIds)]);
  const extraRules = additionalRuleIds.length > 0
    ? (await Promise.all(additionalRuleIds.map((id) => ruleRepo.getBankingRule(companyId, id)))).filter((r): r is NonNullable<typeof r> => r !== null && !listedRules.some((lr) => lr.id === r.id))
    : [];
  const prepared = await prepareRun(companyId, transactions, [...listedRules, ...extraRules]);

  const results: TransactionProcessingResult[] = [];
  for (const transaction of transactions) {
    results.push(await processPrepared(companyId, transaction, prepared, performedBy));
  }
  return results;
}

/** Returns false when `shouldContinue` stopped it before the end. */
async function raiseIntelligenceExceptions(companyId: string, intelligenceInput: IntelligenceTransaction[], shouldContinue: () => boolean): Promise<boolean> {
  const signalsByTransaction = buildBankingIntelligence(intelligenceInput, LARGE_PAYMENT_THRESHOLD);

  for (const [transactionId, signals] of signalsByTransaction) {
    for (const signal of signals) {
      if (!shouldContinue()) return false;
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
  return true;
}

export async function getOrCreateMerchantForTransaction(companyId: string, transaction: BankTransactionRecord) {
  return merchantRepo.getOrCreateMerchantByBeneficiary(companyId, transaction.beneficiary);
}
