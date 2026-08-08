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
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listVatTreatments } from "@/server/repositories/vat-treatment-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as importRepo from "@/server/repositories/import-repository";
import { generateJournalFromTransactions, type BankAccountGlInfo, type GenerateJournalOutcome } from "@/server/services/journal-service";
import { applyRulesToTransactions, type TransactionProcessingResult } from "@/server/services/rule-processing-service";
import type {
  AllocationStatus,
  BankTransactionRecord,
  ReviewStatus,
  TransactionDetail,
  TransactionExplorerCursor,
  TransactionExplorerFilters,
  TransactionExplorerSummary,
  TransactionSortColumn,
} from "@/server/accounting/types";

export class ValidationError extends Error {}

const ALLOCATION_STATUSES: AllocationStatus[] = ["Matched", "Allocated", "Suggested", "Unallocated"];
const SORT_COLUMNS: TransactionSortColumn[] = ["transactionDate", "debit", "credit"];
const REVIEW_STATUSES: ReviewStatus[] = ["Approved", "Rejected", "Ignored"];
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
    repo.listMatchHistory(transactionId),
    repo.listAllocationHistory(transactionId),
    repo.listReviewHistory(transactionId),
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
  type: "G" | "C" | "S";
  accountCode: string | null;
  supplierId: number | null;
  customerId: number | null;
  vatCode: string | null;
  allocationNotes: string;
};

const ALLOCATION_TYPES = ["G", "C", "S"] as const;

/** Transaction Explorer Redesign, Phase 1 — the one validated write path
 * behind the new inline allocation grid, single-row commit and "apply to
 * selected" bulk allocation alike. Closes a real, pre-existing gap: until
 * now `assignGl`/`assignVat` only checked non-empty, never that the code
 * actually exists in `chart_of_accounts`/`vat_treatments` (unlike
 * `assignSupplier`/`assignCustomer`, which already validate existence) —
 * every accountant-facing entry point for GL/VAT now gets that same
 * existence check. */
export async function allocateRow(companyId: string, transactionIds: number[], input: AllocateRowInput, performedBy: string): Promise<void> {
  requireIds(transactionIds);
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
  } else if (input.type === "C") {
    if (input.customerId === null) throw new ValidationError("Customer is required.");
    const customer = await customerRepo.getCustomer(companyId, input.customerId);
    if (!customer) throw new ValidationError(`No customer with id ${input.customerId}.`);
  }

  if (input.vatCode) {
    const treatments = await listVatTreatments(companyId);
    if (!treatments.some((v) => v.code === input.vatCode)) throw new ValidationError(`No VAT treatment with code '${input.vatCode}'.`);
  }

  await repo.allocateRow(
    companyId,
    transactionIds,
    { type: input.type, accountCode: input.accountCode?.trim() ?? null, supplierId: input.supplierId, customerId: input.customerId, vatCode: input.vatCode, allocationNotes: input.allocationNotes },
    performedBy,
  );
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
 * arbitrarily chosen number. */
const REPEATED_ALLOCATION_THRESHOLD = 3;

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
  companyId: string, importBatch: string, excludeTransactionId: number | null, performedBy: string,
): Promise<TransactionProcessingResult[]> {
  if (!importBatch) return [];
  const { transactions } = await listTransactionsForExport(companyId, {
    search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
    statuses: ["Unallocated"], bankAccountId: null, importBatch, duplicateOnly: false, unknownSupplierOnly: false,
    sortBy: "transactionDate", sortDirection: "desc",
  });
  const ids = transactions.map((t) => t.id).filter((id) => id !== excludeTransactionId);
  if (ids.length === 0) return [];
  return applyRulesToTransactions(companyId, ids, performedBy);
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

export async function deleteImport(companyId: string, importType: "bills" | "bank_transactions", importBatch: string): Promise<number> {
  if (!importBatch.trim()) throw new ValidationError("importBatch is required.");
  return importRepo.deleteImportBatch(companyId, importType, importBatch);
}
