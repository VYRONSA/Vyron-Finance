/**
 * Application Service layer for Transaction Explorer — validation,
 * request-shape parsing, and orchestration on top of the repository,
 * never talking to Supabase directly.
 */

import * as repo from "@/server/repositories/transaction-explorer-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as supplierRepo from "@/server/repositories/supplier-reconciliation-repository";
import * as customerRepo from "@/server/repositories/customer-repository";
import * as merchantRepo from "@/server/repositories/merchant-repository";
import * as ruleRepo from "@/server/repositories/banking-rule-repository";
import * as cashbookRepo from "@/server/repositories/cashbook-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listVatTreatments } from "@/server/repositories/vat-treatment-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as importRepo from "@/server/repositories/import-repository";
import { generateJournalFromTransactions, type BankAccountGlInfo, type GenerateJournalOutcome } from "@/server/services/journal-service";
import { applyRulesToTransactions, toEvaluable, type TransactionProcessingResult } from "@/server/services/rule-processing-service";
import { ruleMatches } from "@/server/banking-rules/rule-engine";
import type {
  AllocationMethod,
  AllocationStatus,
  BankTransactionRecord,
  ReviewStatus,
  TransactionDetail,
  TransactionExplorerCursor,
  TransactionExplorerFilters,
  TransactionExplorerSummary,
  TransactionPostingStatus,
  TransactionSortColumn,
} from "@/server/accounting/types";

export class ValidationError extends Error {}

const ALLOCATION_STATUSES: AllocationStatus[] = ["Matched", "Allocated", "Suggested", "Unallocated"];
const ALLOCATION_METHODS: AllocationMethod[] = ["Matched Bill", "Supplier Default", "Manual", "Future AI"];
const SORT_COLUMNS: TransactionSortColumn[] = ["transactionDate", "debit", "credit"];
const REVIEW_STATUSES: ReviewStatus[] = ["Approved", "Rejected", "Ignored"];
const POSTING_STATUSES: TransactionPostingStatus[] = ["Unprocessed", "Ready to Post", "Posted", "Reconciled"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Query-string -> typed filter object. Pure, unit-tested — every enum
 * value is validated rather than cast, so a malformed request fails loudly
 * with a clear message instead of silently querying the wrong thing. */
export function parseFilters(params: URLSearchParams): TransactionExplorerFilters {
  const dateFrom = params.get("dateFrom");
  if (dateFrom && !DATE_RE.test(dateFrom)) throw new ValidationError(`Invalid dateFrom '${dateFrom}' — expected YYYY-MM-DD.`);
  const dateTo = params.get("dateTo");
  if (dateTo && !DATE_RE.test(dateTo)) throw new ValidationError(`Invalid dateTo '${dateTo}' — expected YYYY-MM-DD.`);

  const minAmountRaw = params.get("minAmount");
  const minAmount = minAmountRaw !== null ? Number(minAmountRaw) : null;
  if (minAmount !== null && !Number.isFinite(minAmount)) throw new ValidationError(`Invalid minAmount '${minAmountRaw}'.`);

  const maxAmountRaw = params.get("maxAmount");
  const maxAmount = maxAmountRaw !== null ? Number(maxAmountRaw) : null;
  if (maxAmount !== null && !Number.isFinite(maxAmount)) throw new ValidationError(`Invalid maxAmount '${maxAmountRaw}'.`);

  const statusValues = params.getAll("status");
  for (const s of statusValues) {
    if (!ALLOCATION_STATUSES.includes(s as AllocationStatus)) {
      throw new ValidationError(`Invalid status '${s}' — expected one of ${ALLOCATION_STATUSES.join(", ")}.`);
    }
  }

  const bankAccountIdRaw = params.get("bankAccountId");
  const bankAccountId = bankAccountIdRaw !== null ? Number(bankAccountIdRaw) : null;
  if (bankAccountId !== null && !Number.isInteger(bankAccountId)) throw new ValidationError(`Invalid bankAccountId '${bankAccountIdRaw}'.`);

  // Phase 23A (Find & Recode) — additive filter parsing, same validate-
  // loudly-rather-than-cast discipline as everything above.
  const supplierIdRaw = params.get("supplierId");
  const supplierId = supplierIdRaw !== null ? Number(supplierIdRaw) : null;
  if (supplierId !== null && !Number.isInteger(supplierId)) throw new ValidationError(`Invalid supplierId '${supplierIdRaw}'.`);

  const customerIdRaw = params.get("customerId");
  const customerId = customerIdRaw !== null ? Number(customerIdRaw) : null;
  if (customerId !== null && !Number.isInteger(customerId)) throw new ValidationError(`Invalid customerId '${customerIdRaw}'.`);

  const allocationMethodValues = params.getAll("allocationMethod");
  for (const m of allocationMethodValues) {
    if (!ALLOCATION_METHODS.includes(m as AllocationMethod)) {
      throw new ValidationError(`Invalid allocationMethod '${m}' — expected one of ${ALLOCATION_METHODS.join(", ")}.`);
    }
  }

  // Bank Accounting Posting — validated against the same four-state
  // vocabulary the grid badge and the SQL predicates use, never cast.
  const postingStatusValues = params.getAll("postingStatus");
  for (const p of postingStatusValues) {
    if (!POSTING_STATUSES.includes(p as TransactionPostingStatus)) {
      throw new ValidationError(`Invalid postingStatus '${p}' — expected one of ${POSTING_STATUSES.join(", ")}.`);
    }
  }

  const hasRuleRaw = params.get("hasRule");
  if (hasRuleRaw !== null && hasRuleRaw !== "true" && hasRuleRaw !== "false") throw new ValidationError(`Invalid hasRule '${hasRuleRaw}' — expected 'true' or 'false'.`);
  const hasRule = hasRuleRaw === "true" ? true : hasRuleRaw === "false" ? false : null;

  const sortBy = (params.get("sortBy") ?? "transactionDate") as TransactionSortColumn;
  if (!SORT_COLUMNS.includes(sortBy)) throw new ValidationError(`Invalid sortBy '${sortBy}' — expected one of ${SORT_COLUMNS.join(", ")}.`);

  const sortDirection = params.get("sortDirection") ?? "desc";
  if (sortDirection !== "asc" && sortDirection !== "desc") throw new ValidationError(`Invalid sortDirection '${sortDirection}'.`);

  return {
    search: params.get("search")?.trim() || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    minAmount,
    maxAmount,
    statuses: statusValues.length > 0 ? (statusValues as AllocationStatus[]) : null,
    bankAccountId,
    importBatch: params.get("importBatch") || null,
    duplicateOnly: params.get("duplicateOnly") === "true",
    unknownSupplierOnly: params.get("unknownSupplierOnly") === "true",
    sortBy,
    sortDirection,
    description: params.get("description")?.trim() || null,
    reference: params.get("reference")?.trim() || null,
    glAccount: params.get("glAccount")?.trim() || null,
    supplierId,
    customerId,
    allocationMethods: allocationMethodValues.length > 0 ? (allocationMethodValues as AllocationMethod[]) : null,
    hasRule,
    manualOverrideOnly: params.get("manualOverrideOnly") === "true",
    needsReviewOnly: params.get("needsReviewOnly") === "true",
    postingStatuses: postingStatusValues.length > 0 ? (postingStatusValues as TransactionPostingStatus[]) : null,
  };
}

/** Opaque base64url-encoded JSON — pure, unit-tested. A tampered/garbage
 * cursor fails loudly (`ValidationError`) rather than silently paginating
 * from the wrong place. */
export function encodeCursor(cursor: TransactionExplorerCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string | null): TransactionExplorerCursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    throw new ValidationError("Invalid pagination cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("id" in parsed) ||
    !("sortValue" in parsed) ||
    typeof (parsed as { id: unknown }).id !== "number"
  ) {
    throw new ValidationError("Invalid pagination cursor.");
  }
  const { id, sortValue } = parsed as { id: number; sortValue: unknown };
  if (sortValue !== null && typeof sortValue !== "string" && typeof sortValue !== "number") {
    throw new ValidationError("Invalid pagination cursor.");
  }
  return { id, sortValue: sortValue as string | number | null };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export type TransactionListResult = {
  transactions: BankTransactionRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

export async function listTransactions(
  companyId: string,
  filters: TransactionExplorerFilters,
  cursorParam: string | null,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<TransactionListResult> {
  const limit = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
  const cursor = decodeCursor(cursorParam);
  const { transactions, nextRawCursor, hasMore } = await repo.queryTransactions(companyId, filters, cursor, limit);
  return { transactions, nextCursor: encodeCursor(nextRawCursor), hasMore };
}

export function getSummary(companyId: string): Promise<TransactionExplorerSummary> {
  return repo.getTransactionSummary(companyId);
}

export type { BankingAutomationAggregate, UnmatchedTransactionForQueue, RecentTransactionForDuplicateCheck } from "@/server/repositories/transaction-explorer-repository";

export function getBankingAutomationAggregate(companyId: string) {
  return repo.getBankingAutomationAggregate(companyId);
}

export function listUnmatchedTransactionsForQueue(companyId: string, limit: number) {
  return repo.listUnmatchedTransactionsForQueue(companyId, limit);
}

export function listRecentTransactionsForDuplicateCheck(companyId: string, dateFrom: string, dateTo: string, limit: number) {
  return repo.listRecentTransactionsForDuplicateCheck(companyId, dateFrom, dateTo, limit);
}

const EXPORT_CAP = 50_000;
const EXPORT_BATCH_SIZE = 1000;

/** Reuses `repo.queryTransactions`'s own keyset pagination in a loop
 * rather than a separate large-query path — same filters, same
 * correctness, no duplicated query logic. Capped (not silently — the
 * caller is told whether it was truncated) so an unfiltered export on a
 * 100,000+-row company can't blow up memory or time out the request. */
export async function listTransactionsForExport(
  companyId: string,
  filters: TransactionExplorerFilters,
): Promise<{ transactions: BankTransactionRecord[]; truncated: boolean }> {
  const all: BankTransactionRecord[] = [];
  let cursor: TransactionExplorerCursor | null = null;
  let hasMore = true;

  while (hasMore && all.length < EXPORT_CAP) {
    const remaining = EXPORT_CAP - all.length;
    const batch = await repo.queryTransactions(companyId, filters, cursor, Math.min(EXPORT_BATCH_SIZE, remaining));
    all.push(...batch.transactions);
    cursor = batch.nextRawCursor;
    hasMore = batch.hasMore;
  }

  return { transactions: all, truncated: hasMore };
}

export async function getTransactionDetail(companyId: string, transactionId: number): Promise<TransactionDetail | null> {
  const transaction = await repo.getTransaction(companyId, transactionId);
  if (!transaction) return null;

  const [bankAccount, matchedSupplier, matchedCustomer, matchedMerchant, journal, matchHistory, allocationHistory, reviewHistory] = await Promise.all([
    transaction.bankAccountId !== null ? bankAccountRepo.getBankAccount(companyId, transaction.bankAccountId) : Promise.resolve(null),
    transaction.matchedSupplierId !== null ? supplierRepo.getSupplier(companyId, transaction.matchedSupplierId) : Promise.resolve(null),
    transaction.matchedCustomerId !== null ? customerRepo.getCustomer(companyId, transaction.matchedCustomerId) : Promise.resolve(null),
    transaction.matchedMerchantId !== null ? merchantRepo.getMerchant(companyId, transaction.matchedMerchantId) : Promise.resolve(null),
    transaction.journalId !== null ? journalRepo.getJournal(companyId, transaction.journalId) : Promise.resolve(null),
    repo.listMatchHistory(companyId, transactionId),
    repo.listAllocationHistory(companyId, transactionId),
    repo.listReviewHistory(companyId, transactionId),
  ]);

  return { transaction, bankAccount, matchedSupplier, matchedCustomer, matchedMerchant, journal, matchHistory, allocationHistory, reviewHistory };
}

export const getTransactionsByJournalId = repo.getTransactionsByJournalId;

function requireIds(transactionIds: number[]) {
  if (transactionIds.length === 0) throw new ValidationError("Select at least one transaction.");
}

export async function applyBulkReview(
  companyId: string,
  transactionIds: number[],
  newStatus: ReviewStatus,
  note: string,
  performedBy: string,
): Promise<BankTransactionRecord[]> {
  requireIds(transactionIds);
  if (!REVIEW_STATUSES.includes(newStatus)) throw new ValidationError(`Invalid review status '${newStatus}'.`);
  return Promise.all(transactionIds.map((id) => repo.applyReview(companyId, id, newStatus, note, performedBy)));
}

export async function assignSupplier(companyId: string, transactionIds: number[], supplierId: number, performedBy: string): Promise<void> {
  requireIds(transactionIds);
  const supplier = await supplierRepo.getSupplier(companyId, supplierId);
  if (!supplier) throw new ValidationError(`No supplier with id ${supplierId}.`);
  // Phase 38 — the UI already filters Inactive suppliers out of every
  // picker; this is the server-side backstop so a request can never
  // create a new assignment to one regardless of what the client sends.
  if (supplier.status !== "Active") throw new ValidationError(`Supplier "${supplier.name}" is Inactive and cannot be assigned.`);
  await repo.bulkAssignSupplier(companyId, transactionIds, supplierId, performedBy);
}

export async function assignGl(companyId: string, transactionIds: number[], glAccount: string, performedBy: string): Promise<void> {
  requireIds(transactionIds);
  if (!glAccount.trim()) throw new ValidationError("GL account is required.");
  await repo.bulkAssignGl(companyId, transactionIds, glAccount.trim(), performedBy);
}

export async function assignVat(companyId: string, transactionIds: number[], vatCode: string, performedBy: string): Promise<void> {
  requireIds(transactionIds);
  if (!vatCode.trim()) throw new ValidationError("VAT treatment is required.");
  await repo.bulkAssignVat(companyId, transactionIds, vatCode.trim(), performedBy);
}

/** Real now that Merchants exist (Migration Roadmap Module 6) — the
 * stale "No Merchant Coding Centre module exists yet" tooltip this
 * replaced predated Banking Automation shipping. */
export async function assignMerchant(companyId: string, transactionIds: number[], merchantId: number, performedBy: string): Promise<void> {
  requireIds(transactionIds);
  const merchant = await merchantRepo.getMerchant(companyId, merchantId);
  if (!merchant) throw new ValidationError(`No merchant with id ${merchantId}.`);
  await repo.bulkAssignMerchant(companyId, transactionIds, merchantId, performedBy);
}

/** Real now that Customer Management exists — the stale "No Customer
 * concept exists in this accounting engine yet" tooltip this replaced
 * predated Customer Management shipping. */
export async function assignCustomer(companyId: string, transactionIds: number[], customerId: number, performedBy: string): Promise<void> {
  requireIds(transactionIds);
  const customer = await customerRepo.getCustomer(companyId, customerId);
  if (!customer) throw new ValidationError(`No customer with id ${customerId}.`);
  await repo.bulkAssignCustomer(companyId, transactionIds, customerId, performedBy);
}

export type AllocateRowInput = {
  /** Phase 31B — `null` means "this commit does not touch the
   * allocation" (no Type chosen — a description/notes/VAT-only fix on an
   * otherwise Unallocated row). Every allocation-specific check below is
   * skipped entirely in that case; `null` is never a synonym for "clear
   * the existing allocation" — the repository only ever writes
   * `allocation_type: null` when the row already had no allocation to
   * begin with (the client only ever sends `type: null` when its own
   * `edit.type` is null, which only happens for a still-Unallocated row —
   * see `transaction-grid.tsx::commitRow`). */
  type: "G" | "C" | "S" | null;
  accountCode: string | null;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string | null;
  allocationNotes: string;
  /** Phase 31A — `null` means "unchanged"; see `repo.AllocateRowFields`. */
  description: string | null;
  /** Supplier Invoice Matching Override (migration 0095). `null` means
   * "unchanged, omit from the UPDATE" — the same convention `description`
   * uses — so an ordinary allocation commit never silently clears an
   * override the accountant set earlier. `true`/`false` is a deliberate
   * change. It lifts only the invoice-matching requirement; it never
   * creates an invoice, a bill or a match, and never classifies.
   *
   * REQUIRED, not optional, and deliberately so: while it was optional,
   * `allocateRow` below could — and did — forget to forward it to the
   * repository with no type error at all, so a ticked override was
   * reported as saved and never written. A caller with nothing to say
   * about the override passes `null` explicitly. */
  overrideSupplierInvoiceMatching: boolean | null;
};

export type AllocateRowResult = repo.AllocateRowResult;

const ALLOCATION_TYPES = ["G", "C", "S"] as const;

/** Transaction Explorer Redesign, Phase 1 — the one validated write path
 * behind the new inline allocation grid, single-row commit and "apply to
 * selected" bulk allocation alike. Closes a real, pre-existing gap: until
 * now `assignGl`/`assignVat` only checked non-empty, never that the code
 * actually exists in `chart_of_accounts`/`vat_treatments` (unlike
 * `assignSupplier`/`assignCustomer`, which already validate existence) —
 * every accountant-facing entry point for GL/VAT now gets that same
 * existence check.
 *
 * Phase 31B — "the user must be able to correct a Description without
 * being forced to allocate." `input.type === null` skips every
 * allocation-specific check below (never partially — there's no such
 * thing as a "half-validated" allocation) while VAT existence validation
 * (already independent of Type before this phase) is untouched. */
export async function allocateRow(companyId: string, transactionIds: number[], input: AllocateRowInput, performedBy: string): Promise<AllocateRowResult> {
  requireIds(transactionIds);

  if (input.type !== null) {
    if (!ALLOCATION_TYPES.includes(input.type)) throw new ValidationError(`Invalid allocation type '${input.type}' — expected G, C, or S.`);

    if (input.type === "G") {
      const accountCode = input.accountCode?.trim();
      if (!accountCode) throw new ValidationError("GL account is required.");
      const accounts = await listChartOfAccounts(companyId);
      if (!accounts.some((a) => a.accountCode === accountCode)) throw new ValidationError(`No GL account with code '${accountCode}'.`);
    } else if (input.type === "S") {
      if (input.supplierId === null) throw new ValidationError("Supplier is required.");
      const supplier = await supplierRepo.getSupplier(companyId, input.supplierId);
      if (!supplier) throw new ValidationError(`No supplier with id ${input.supplierId}.`);
      // Phase 38 — same backstop as `assignSupplier` above, for the
      // inline single-row allocation path.
      if (supplier.status !== "Active") throw new ValidationError(`Supplier "${supplier.name}" is Inactive and cannot be assigned.`);
    } else if (input.type === "C") {
      if (input.customerId === null) throw new ValidationError("Customer is required.");
      const customer = await customerRepo.getCustomer(companyId, input.customerId);
      if (!customer) throw new ValidationError(`No customer with id ${input.customerId}.`);
    }
  }

  if (input.vatCode) {
    const treatments = await listVatTreatments(companyId);
    if (!treatments.some((v) => v.code === input.vatCode)) throw new ValidationError(`No VAT treatment with code '${input.vatCode}'.`);
  }

  try {
    return await repo.allocateRow(
      companyId,
      transactionIds,
      {
        type: input.type,
        accountCode: input.accountCode?.trim() ?? null,
        supplierId: input.supplierId,
        customerId: input.customerId,
        vatCode: input.vatCode,
        allocationNotes: input.allocationNotes,
        description: input.description,
        // PRODUCTION DEFECT: this field was accepted by the route, typed
        // on `AllocateRowInput`, written by the repository — and silently
        // dropped right here, because this object is built field by field
        // and this one was never added to it. The accountant ticked
        // "Override Supplier Invoice Matching", saw "allocations updated
        // successfully", and the posting preflight still refused the
        // payment for having no invoice: the override had never reached
        // the database at all. TypeScript could not catch it — omitting a
        // property from an object literal that satisfies a type with that
        // property optional-by-position is not an error.
        overrideSupplierInvoiceMatching: input.overrideSupplierInvoiceMatching,
      },
      performedBy,
    );
  } catch (error) {
    // Phase 31A — same established pattern as
    // `chart-of-accounts-service.ts::isDuplicateAccountCode`: a raw
    // Postgres `23505` is never acceptable to surface directly.
    if (repo.isDuplicateNaturalKey(error)) {
      throw new ValidationError("This description would make the transaction identical to another one already on this bank account, date, reference, and amount — try a different description.");
    }
    throw error;
  }
}

/** Runs the Banking Rule Engine against exactly the selected
 * transactions — the real "Apply Rule" bulk action. */
export async function applyRule(companyId: string, transactionIds: number[], performedBy: string): Promise<TransactionProcessingResult[]> {
  requireIds(transactionIds);
  return applyRulesToTransactions(companyId, transactionIds, performedBy);
}

/** Pilot Review Round 1, Phase 7 — the repeated-allocation intelligence
 * threshold. 3 matches this codebase's own precedent for "this is a
 * pattern, not a coincidence" (the Matching Engine's own minimum
 * training-sample size elsewhere in this platform) rather than an
 * arbitrarily chosen number. Exported (Phase 25D) so
 * `repeated-correction-detector.ts`'s proactive scan reuses the exact
 * same threshold rather than a second hardcoded `3`. */
export const REPEATED_ALLOCATION_THRESHOLD = 3;

export async function getRepeatedAllocationCount(
  companyId: string,
  transactionId: number,
  beneficiary: string,
  target: { glAccount?: string; customerId?: number; supplierId?: number },
): Promise<{ count: number; suggestRule: boolean }> {
  const count = await repo.countBeneficiaryAllocations(companyId, beneficiary, target, transactionId);
  return { count, suggestRule: count >= REPEATED_ALLOCATION_THRESHOLD };
}

/** Pilot Review Round 1, Phase 6 — "the accountant must never need to
 * import the statement a second time." Called right after a Banking
 * Rule is created inline during allocation: scans every still-Unallocated
 * transaction in the SAME import batch and runs them through the real
 * Rule Engine pipeline (`applyRulesToTransactions`, the exact function
 * behind the existing manual "Apply Rule" bulk action) — the new rule is
 * already active and in the database by the time this runs, so it
 * naturally participates alongside every other active rule; no separate
 * single-rule code path was needed. */
export async function applyRulesToRemainingBatchTransactions(
  companyId: string, importBatch: string, excludeTransactionId: number | null, performedBy: string, newRuleId: number | null = null,
): Promise<TransactionProcessingResult[]> {
  if (!importBatch) return [];
  const { transactions } = await listTransactionsForExport(companyId, {
    search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
    statuses: ["Unallocated"], bankAccountId: null, importBatch, duplicateOnly: false, unknownSupplierOnly: false,
    sortBy: "transactionDate", sortDirection: "desc",
  });
  const ids = transactions.map((t) => t.id).filter((id) => id !== excludeTransactionId);
  if (ids.length === 0) return [];
  // Master Implementation Tracker — Programme 2, Epic E2, Finding #207.
  return applyRulesToTransactions(companyId, ids, performedBy, newRuleId !== null ? [newRuleId] : []);
}

export type RuleApplicationSummary = {
  matchedCount: number;
  allocatedCount: number;
  alreadyAllocatedCount: number;
  rejectedCount: number;
  allocatedTransactionIds: number[];
};

/** Phase 39 — root cause of "Supplier created and applied to 0 new
 * transactions in this statement": `applyRulesToRemainingBatchTransactions`
 * above is (correctly, for what it's for) scoped to one import batch —
 * but the Set Rule flow calls it as if it were company-wide, so a "fish"
 * transaction sitting in a DIFFERENT statement/batch was never evaluated
 * at all. This is the real company-wide counterpart, called once,
 * immediately after a rule is created from Transaction Explorer.
 *
 * Reuses the existing engine throughout — no new matching logic:
 * `listUnprocessedTransactions` (already `runRuleEngine`'s own worklist,
 * journal_id IS NULL, company-wide) is the candidate pool, `ruleMatches`
 * (the exact function `evaluateTransactionAgainstRules` already calls
 * internally) determines which candidates the new rule's own condition
 * matches — independent of every OTHER active rule, so this summary is
 * never conflated with a coincidental match from an unrelated rule.
 *
 * Phase 40, Live Defect 2 — production forensic finding: the ORIGINAL
 * version of this function wrote through `applyRulesToTransactions` (the
 * same pipeline `runRuleEngine`/"Apply Rule" use), whose underlying
 * `applyRuleActions` guard requires a transaction to be COMPLETELY
 * untouched before ANY rule can claim it. Live testing proved every
 * "Three Streams Fish" transaction had already been claimed by the AI
 * Classification Sweep (a background cron task) DAYS before the
 * accountant created this Supplier rule — with a generic, NEVER
 * human-confirmed "Purchases" GL guess (`is_manual_override: false`).
 * That guard silently no-oped every write, so the rule reported "0
 * allocated" even though it had genuinely found the right transactions.
 * "Already allocated" now means a HUMAN already confirmed some
 * allocation (`is_manual_override = true`) — an unconfirmed automatic
 * guess is exactly what a deliberately-authored, more specific new rule
 * is meant to supersede, not a permanent lock. The actual write goes
 * through `repo.applyRuleActionsBatchOverridingAiSuggestions` — a new,
 * narrowly-scoped path used ONLY here, never by the ongoing
 * `runRuleEngine`/`applyRulesToTransactions` passes, so their own
 * "never clobber another automatic pass" guarantee is completely
 * unchanged. Posted transactions remain fully protected either way —
 * `listUnprocessedTransactions` never returns them in the first place. */
/** Phase 51 — the matching/eligibility computation `applyNewRuleCompanyWide`
 * and its new read-only sibling `previewApplyRuleCompanyWide` both need,
 * extracted once so a preview can never disagree with what the real apply
 * would actually do (the exact "no assumption, no drift between preview and
 * commit" discipline `find-and-recode-service.ts`'s own preview/commit
 * pair already established for a different feature). Read-only — no write,
 * no history row, callable freely from a preview path. */
async function resolveRuleMatches(companyId: string, ruleId: number, excludeTransactionId: number | null) {
  const rule = await ruleRepo.getBankingRule(companyId, ruleId);
  if (!rule) return null;

  const candidates = await repo.listUnprocessedTransactions(companyId);
  const alwaysActive = { ...rule, isActive: true };
  const matched = candidates.filter((t) => t.id !== excludeTransactionId && ruleMatches(toEvaluable(t), alwaysActive));

  const eligible = matched.filter((t) => !t.isManualOverride);
  const alreadyAllocatedCount = matched.length - eligible.length;
  return { rule, matched, eligible, alreadyAllocatedCount };
}

export type RuleMatchPreview = { matchedCount: number; eligibleCount: number; alreadyAllocatedCount: number };

/** Phase 51 — production defect: "Apply to Remaining Transactions"
 * previously ran the FULL company-wide sweep immediately and silently the
 * moment a new rule was created (that default was itself the bug — see
 * the Phase 50 forensic report). This is the read-only "how many would
 * this affect?" step the UI now calls BEFORE ever asking to apply, so the
 * accountant sees and explicitly confirms the blast radius instead of
 * discovering it after the fact in `ae_bank_transactions`. Writes
 * nothing — reuses the exact same `resolveRuleMatches` the real apply
 * below uses, so the number shown here can never disagree with what
 * confirming would actually do. */
export async function previewApplyRuleCompanyWide(companyId: string, ruleId: number, excludeTransactionId: number | null): Promise<RuleMatchPreview> {
  const resolved = await resolveRuleMatches(companyId, ruleId, excludeTransactionId);
  if (!resolved) return { matchedCount: 0, eligibleCount: 0, alreadyAllocatedCount: 0 };
  return { matchedCount: resolved.matched.length, eligibleCount: resolved.eligible.length, alreadyAllocatedCount: resolved.alreadyAllocatedCount };
}

export async function applyNewRuleCompanyWide(
  companyId: string,
  ruleId: number,
  excludeTransactionId: number | null,
  performedBy: string,
): Promise<RuleApplicationSummary> {
  const matchResult = await resolveRuleMatches(companyId, ruleId, excludeTransactionId);
  if (!matchResult) return { matchedCount: 0, allocatedCount: 0, alreadyAllocatedCount: 0, rejectedCount: 0, allocatedTransactionIds: [] };
  const { rule, matched, eligible, alreadyAllocatedCount } = matchResult;

  if (eligible.length === 0) {
    return { matchedCount: matched.length, allocatedCount: 0, alreadyAllocatedCount, rejectedCount: 0, allocatedTransactionIds: [] };
  }

  // Resolve the rule's own actions ONCE — every eligible transaction is
  // being claimed by this ONE rule, so they all resolve to the same
  // fields. Mirrors `rule-processing-service.ts::processTransaction`'s
  // own action-interpretation switch exactly (no second definition of
  // what each action type means), minus `flag_for_review` — this
  // retroactive-apply path never raises exceptions, matching its
  // narrower "claim previously-AI-touched rows for this new rule" scope.
  const resolved: repo.RuleResolutionFields = { ruleId: rule.id };
  for (const action of rule.actions) {
    switch (action.actionType) {
      case "set_merchant":
        if (action.targetId !== null) resolved.matchedMerchantId = action.targetId;
        break;
      case "set_supplier":
        if (action.targetId !== null) resolved.matchedSupplierId = action.targetId;
        break;
      case "set_customer":
        if (action.targetId !== null) resolved.matchedCustomerId = action.targetId;
        break;
      case "set_gl_account":
        if (action.targetText) resolved.suggestedGlAccount = action.targetText;
        break;
      case "set_vat_code":
        if (action.targetText) resolved.suggestedVatCode = action.targetText;
        break;
    }
  }
  resolved.allocationStatus = resolved.matchedSupplierId !== undefined || resolved.matchedCustomerId !== undefined ? "Allocated" : "Suggested";

  const eligibleIds = eligible.map((t) => t.id);
  const { updatedIds } = await repo.applyRuleActionsBatchOverridingAiSuggestions(companyId, eligibleIds, resolved, rule.name, performedBy);
  if (updatedIds.length > 0) {
    await Promise.all(updatedIds.map((id) => ruleRepo.recordRuleApplication(companyId, rule.id, id)));
  }

  return {
    matchedCount: matched.length,
    allocatedCount: updatedIds.length,
    alreadyAllocatedCount,
    rejectedCount: eligible.length - updatedIds.length,
    allocatedTransactionIds: updatedIds,
  };
}

export async function generateJournal(companyId: string, transactionIds: number[]): Promise<GenerateJournalOutcome> {
  requireIds(transactionIds);
  const transactions = await repo.getTransactionsByIds(companyId, transactionIds);

  const bankAccountIds = [...new Set(transactions.map((t) => t.bankAccountId).filter((id): id is number => id !== null))];
  const bankAccounts = await Promise.all(bankAccountIds.map((id) => bankAccountRepo.getBankAccount(companyId, id)));
  const bankAccountsById = new Map<number, BankAccountGlInfo>();
  bankAccounts.forEach((account) => {
    if (account) bankAccountsById.set(account.id, { glAccount: account.glAccount, accountNumber: account.accountNumber });
  });

  return generateJournalFromTransactions(companyId, transactions, bankAccountsById);
}

export type ReviewHoldOutcome = repo.ReviewHoldResult;

/**
 * Hold selected transactions for human review, or release that hold.
 *
 * A held transaction is off-limits to every automatic classifier — the
 * AI sweep, automatic GL suggestion, and automatic VAT assignment — for
 * as long as the hold stands (migration 0094). It is the deliberate way
 * to say "leave these alone, I am working on them", which the Metanoia
 * migration needed and did not have: 40 transactions were auto-classified
 * out from under a review that was already in progress.
 *
 * Holding changes nothing about the transaction's own accounting: not
 * its amount, not its source account, not its allocation, not its
 * posting status.
 */
export async function setReviewHold(
  companyId: string,
  transactionIds: number[],
  hold: boolean,
  reason: string,
  performedBy: string,
): Promise<ReviewHoldOutcome> {
  requireIds(transactionIds);
  if (hold && !reason.trim()) throw new ValidationError("A reason is required when holding transactions for review.");
  return repo.setReviewHold(companyId, transactionIds, hold, reason.trim(), performedBy);
}

export async function deleteImport(companyId: string, importType: "bills" | "bank_transactions", importBatch: string): Promise<number> {
  if (!importBatch.trim()) throw new ValidationError("importBatch is required.");

  // Master Implementation Tracker — Epic E11, Finding #004. Deleting a
  // batch that already has journaled transactions would silently orphan
  // posted GL activity (no source transaction left to trace it back to).
  const journaledCount = await importRepo.countJournaledInBatch(companyId, importType, importBatch);
  if (journaledCount > 0) {
    throw new ValidationError(
      `Cannot delete this import — ${journaledCount} transaction${journaledCount === 1 ? " has" : "s have"} already been journaled to the General Ledger. Reverse or unlink the related journal(s) first.`,
    );
  }

  return importRepo.deleteImportBatch(companyId, importType, importBatch);
}

const SIMILAR_CRITERIA = ["merchant", "description", "amount", "reference"] as const;
export type SimilarCriterion = (typeof SIMILAR_CRITERIA)[number];

/** Finding #086 — company-wide count for a "select similar" criterion,
 * so the client can disclose when more matches exist than are visible
 * on the current page. */
export async function countSimilarTransactions(companyId: string, criterion: string, value: string): Promise<number> {
  if (!SIMILAR_CRITERIA.includes(criterion as SimilarCriterion)) throw new ValidationError(`Unknown criterion '${criterion}'.`);
  if (!value.trim()) throw new ValidationError("value is required.");
  return repo.countMatchingTransactions(companyId, criterion as SimilarCriterion, criterion === "amount" ? Number(value) : value);
}

export type MerchantStats = {
  allocatedCount: number;
  typicalGlAccount: string | null;
  typicalVatCode: string | null;
  avgConfidence: number | null;
  previousTransactions: BankTransactionRecord[];
};

/** Most frequent non-empty value — "typically allocated to GL 440000"
 * rather than just the most recent one, which could be a one-off
 * correction. Pure, exported for direct testing. */
export function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

export type DeleteTransactionsResult = repo.DeleteTransactionsResult;

/** Phase 39 — Delete Transaction. Deliberately thin: `requireIds` for the
 * same "nothing selected" guard every other bulk action already has, then
 * straight to the repository — company ownership and the posted-transaction
 * guard are both enforced there (`.eq("company_id", ...)`/`.is("journal_id",
 * null)`), not re-checked here, matching this file's own existing division
 * of labour (see `allocateRow` immediately above for the same pattern). */
export async function deleteTransactions(companyId: string, transactionIds: number[]): Promise<DeleteTransactionsResult> {
  requireIds(transactionIds);
  return repo.deleteTransactions(companyId, transactionIds);
}

export type NewExplorerTransactionInput = {
  bankAccountId: number;
  transactionDate: string;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  balance: number | null;
  glAccount: string;
  vat: number;
  notes: string;
  supplierId: number | null;
  customerId: number | null;
};

/** Phase 39 — "+ Add Transaction." Captures the same raw, as-if-imported
 * fields `captureCashbookReceipt`/`captureCashbookPayment` already do
 * (bank account, date, reference, description, beneficiary, one of
 * debit/credit, a free-text GL account, a VAT amount, notes) via the
 * SAME `cashbookRepo.createManualTransaction` insert — never a second
 * manual-creation code path — so `import_description`/`entry_source:
 * "Manual"` are populated exactly as that existing implementation
 * already does (Phase 31C's immutable import identity, untouched here).
 * Optionally assigns a Supplier or Customer immediately after creation
 * by calling the EXISTING, already-validated `assignSupplier`/
 * `assignCustomer` above — same Active-only/existence checks every other
 * caller of those functions gets, no new validation invented. */
export async function createManualExplorerTransaction(companyId: string, input: NewExplorerTransactionInput, performedBy: string): Promise<BankTransactionRecord> {
  if (!input.bankAccountId) throw new ValidationError("Bank account is required.");
  const bankAccount = await bankAccountRepo.getBankAccount(companyId, input.bankAccountId);
  if (!bankAccount) throw new ValidationError(`No bank account with id ${input.bankAccountId}.`);
  if (!input.transactionDate) throw new ValidationError("Transaction date is required.");
  if (!input.description.trim()) throw new ValidationError("Description is required.");
  if (!input.beneficiary.trim()) throw new ValidationError("Beneficiary is required.");

  const debit = input.debit || 0;
  const credit = input.credit || 0;
  // "Never silently convert invalid input" — both a Debit and a Credit,
  // or neither, is rejected outright rather than guessed at (e.g.
  // silently zeroing one side, or treating a blank amount as zero).
  if (debit > 0 && credit > 0) throw new ValidationError("A transaction cannot have both a Debit and a Credit amount — enter one or the other.");
  if (debit <= 0 && credit <= 0) throw new ValidationError("Enter either a Debit or a Credit amount.");

  if (input.glAccount.trim()) {
    const accounts = await listChartOfAccounts(companyId);
    if (!accounts.some((a) => a.accountCode === input.glAccount.trim())) throw new ValidationError(`No GL account with code '${input.glAccount.trim()}'.`);
  }

  if (input.supplierId !== null && input.customerId !== null) throw new ValidationError("Choose a Supplier or a Customer, not both.");
  // Phase 38 — same Active-only backstop as every other supplier-assignment
  // entry point; checked here BEFORE creating the transaction so an
  // invalid supplier never even gets a bare row created for it.
  if (input.supplierId !== null) {
    const supplier = await supplierRepo.getSupplier(companyId, input.supplierId);
    if (!supplier) throw new ValidationError(`No supplier with id ${input.supplierId}.`);
    if (supplier.status !== "Active") throw new ValidationError(`Supplier "${supplier.name}" is Inactive and cannot be assigned.`);
  }
  if (input.customerId !== null) {
    const customer = await customerRepo.getCustomer(companyId, input.customerId);
    if (!customer) throw new ValidationError(`No customer with id ${input.customerId}.`);
  }

  const created = await cashbookRepo.createManualTransaction(companyId, {
    bankAccountId: input.bankAccountId,
    bankAccount: bankAccount.accountName,
    transactionDate: input.transactionDate,
    reference: input.reference,
    description: input.description,
    beneficiary: input.beneficiary,
    debit,
    credit,
    glAccount: input.glAccount.trim(),
    vat: input.vat || 0,
    notes: input.notes,
    cashbookBatchId: null,
    balance: input.balance,
  });

  if (input.supplierId !== null) await assignSupplier(companyId, [created.id], input.supplierId, performedBy);
  else if (input.customerId !== null) await assignCustomer(companyId, [created.id], input.customerId, performedBy);
  else return created;

  const final = await repo.getTransaction(companyId, created.id);
  return final ?? created;
}

/** Finding #089 — Merchant Intelligence Panel stats, computed
 * company-wide instead of from only the currently loaded page. */
export async function getMerchantStats(companyId: string, beneficiary: string): Promise<MerchantStats> {
  if (!beneficiary.trim()) throw new ValidationError("beneficiary is required.");
  const matches = await repo.listTransactionsByBeneficiary(companyId, beneficiary);
  const allocated = matches.filter((t) => t.allocationStatus === "Allocated" || t.allocationStatus === "Matched");
  const confidenceScores = matches.map((t) => t.confidenceScore).filter((c): c is number => c !== null);
  return {
    allocatedCount: allocated.length,
    typicalGlAccount: modeOf(allocated.map((t) => t.suggestedGlAccount)),
    typicalVatCode: modeOf(allocated.map((t) => t.suggestedVatCode)),
    avgConfidence: confidenceScores.length > 0 ? Math.round(confidenceScores.reduce((sum, c) => sum + c, 0) / confidenceScores.length) : null,
    previousTransactions: matches,
  };
}
