/**
 * Phase 23A — Find & Recode. Search is entirely reused (this file adds no
 * search logic of its own — see `listTransactions`/`parseFilters`/
 * `queryTransactions`, extended with new filter fields but otherwise
 * unchanged). This file owns only what's genuinely new: resolving a
 * "selection" (explicit ids, or every transaction currently matching a
 * filter — the safety-critical "all visible" vs "all matching"
 * distinction, resolved server-side, never trusting a client-enumerated
 * id list for "all matching"), previewing a bulk recode before anything
 * is written, and committing it through the EXISTING allocation
 * mechanism (`bulkRecodeGlAccount`/`bulkRecodeSupplier`/
 * `bulkRecodeCustomer`/`bulkRecodeVat`, each a sibling of the existing
 * `bulkAssignX` function in the repository — same `ae_allocation_history`
 * trail, no parallel posting mechanism).
 *
 * Originally GL-account-only (Phase 23A's own section 6 deferred
 * supplier/customer/VAT). Phase 25G extends this file to all four —
 * `resolveSelectionAndSplit`/`MAX_RECODE_BATCH_SIZE`/posted-transaction
 * protection are shared by every recode kind below; only target
 * validation (`requireActiveGlAccount`/`requireCompanySupplier`/
 * `requireCompanyCustomer`/`requireActiveVatTreatment`) and the final
 * write call differ. VAT recode was confirmed safe by inspection before
 * being added: `suggested_vat_code` is informational only, never read by
 * journal posting or VAT Return computation (see `commitVatRecode`'s own
 * docstring below for the full reasoning).
 */

import * as repo from "@/server/repositories/transaction-explorer-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { listVatTreatments } from "@/server/repositories/vat-treatment-repository";
import * as supplierRepo from "@/server/repositories/supplier-reconciliation-repository";
import * as customerRepo from "@/server/repositories/customer-repository";
import { listTransactionsForExport, ValidationError } from "@/server/services/transaction-explorer-service";
import type { BankTransactionRecord, TransactionExplorerFilters } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";

export { ValidationError };

/** A conservative, explicit cap (this ticket's own section 15 — "do not
 * allow an accidental unlimited operation... choose a conservative limit
 * and document it"). No existing bulk-allocation limit exists to reuse
 * (`assignGl`/`allocateRow` have none — see the research this phase's
 * completion report cites); Phase 22A/22B's own `MAX_AI_CLASSIFICATIONS_PER_RUN`
 * (20) is deliberately NOT reused here — that number is sized for
 * synchronous per-transaction AI model calls, a different cost profile
 * than a single bulk SQL UPDATE. 500 is large enough to usefully recode
 * a real import batch's worth of misclassified transactions in one pass,
 * small enough that a search gone too broad (e.g. no filters at all)
 * fails loudly and safely rather than silently touching everything. */
export const MAX_RECODE_BATCH_SIZE = 500;

const PREVIEW_SAMPLE_SIZE = 20;

export type RecodeSelection = { mode: "ids"; transactionIds: number[] } | { mode: "all-matching"; filters: TransactionExplorerFilters };

async function resolveSelection(companyId: string, selection: RecodeSelection): Promise<{ transactions: BankTransactionRecord[]; requestedCount: number }> {
  if (selection.mode === "ids") {
    if (selection.transactionIds.length === 0) throw new ValidationError("Select at least one transaction.");
    const transactions = await repo.getTransactionsByIds(companyId, selection.transactionIds);
    // `getTransactionsByIds` is already `company_id`-scoped (a foreign id
    // simply matches zero rows) — but silently proceeding on fewer
    // transactions than requested would hide exactly the "invalid id" /
    // "another company's id" cases this ticket explicitly wants rejected
    // (sections 13/21 items 24-25), so this is treated as a hard error
    // here rather than an inert no-op.
    if (transactions.length !== selection.transactionIds.length) {
      throw new ValidationError("Some of the selected transactions could not be found — they may not exist, or may not belong to this company.");
    }
    return { transactions, requestedCount: selection.transactionIds.length };
  }

  const { transactions, truncated } = await listTransactionsForExport(companyId, selection.filters);
  // `truncated` means more than listTransactionsForExport's own (much
  // larger, 50,000-row) internal cap matched — definitely over
  // MAX_RECODE_BATCH_SIZE too. The exact true total isn't known (and
  // isn't needed): `requestedCount` only has to prove ">
  // MAX_RECODE_BATCH_SIZE" to the caller below, which this sentinel does
  // without an extra COUNT query or mutating the (already large) array.
  const requestedCount = truncated ? MAX_RECODE_BATCH_SIZE + 1 : transactions.length;
  return { transactions, requestedCount };
}

async function requireActiveGlAccount(companyId: string, accountCode: string | undefined | null): Promise<ChartOfAccount> {
  const trimmed = accountCode?.trim();
  if (!trimmed) throw new ValidationError("A new GL account is required.");
  const accounts = await listChartOfAccounts(companyId);
  const account = accounts.find((a) => a.accountCode === trimmed);
  if (!account) throw new ValidationError(`No GL account with code '${trimmed}'.`);
  if (!account.isActive) throw new ValidationError(`GL account '${trimmed}' is inactive and cannot be used.`);
  return account;
}

/** Same shape as `requireActiveGlAccount` above, for `vat_treatments`
 * instead of `chart_of_accounts` — Phase 25G's VAT recode. `Inactive`
 * checked the same way, so a retired VAT treatment can't be reintroduced
 * via Find & Recode any more than an inactive GL account can. */
async function requireActiveVatTreatment(companyId: string, vatCode: string | undefined | null): Promise<VatTreatment> {
  const trimmed = vatCode?.trim();
  if (!trimmed) throw new ValidationError("A new VAT treatment is required.");
  const treatments = await listVatTreatments(companyId);
  const treatment = treatments.find((t) => t.code === trimmed);
  if (!treatment) throw new ValidationError(`No VAT treatment with code '${trimmed}'.`);
  if (!treatment.isActive) throw new ValidationError(`VAT treatment '${trimmed}' is inactive and cannot be used.`);
  return treatment;
}

/** Shared by every recode kind (GL, and Phase 25G's supplier/customer) —
 * resolves the selection, enforces the batch cap BEFORE anything is
 * written or shown as actionable, and splits out already-posted
 * transactions (this ticket's own section 9: posted transactions
 * "require a different process, keep them protected"). No existing
 * `assignGl`/`allocateRow`/`bulkAssignGl`/`bulkAssignSupplier`/
 * `bulkAssignCustomer` call checks `journalId` at all (confirmed by
 * inspection) — this is Find & Recode's OWN gate, layered in front of
 * the unmodified, reused write mechanisms, exactly like Phase 22B's
 * `isEligibleForAiClassification` gate sits in front of
 * `applyAiClassification` without changing it. */
async function resolveSelectionAndSplit(companyId: string, selection: RecodeSelection): Promise<{ transactions: BankTransactionRecord[]; eligible: BankTransactionRecord[]; posted: BankTransactionRecord[] }> {
  const { transactions, requestedCount } = await resolveSelection(companyId, selection);

  if (requestedCount > MAX_RECODE_BATCH_SIZE) {
    throw new ValidationError(
      `${requestedCount} transactions match — Find & Recode allows at most ${MAX_RECODE_BATCH_SIZE} at a time. Narrow your filters or selection and try again.`,
    );
  }

  const eligible = transactions.filter((t) => t.journalId === null);
  const posted = transactions.filter((t) => t.journalId !== null);
  return { transactions, eligible, posted };
}

async function resolveAndValidate(companyId: string, selection: RecodeSelection, newGlAccountCode: string) {
  const account = await requireActiveGlAccount(companyId, newGlAccountCode);
  const { transactions, eligible, posted } = await resolveSelectionAndSplit(companyId, selection);
  return { account, transactions, eligible, posted };
}

/** Same company-ownership check `assignSupplier`/`allocateRow`'s "S"
 * case already use — a foreign-company id simply resolves to `null` from
 * `getSupplier`'s own `company_id`-scoped query, never needing a second,
 * separate ownership test. */
async function requireCompanySupplier(companyId: string, supplierId: number | undefined | null) {
  if (supplierId === undefined || supplierId === null) throw new ValidationError("A new supplier is required.");
  const supplier = await supplierRepo.getSupplier(companyId, supplierId);
  if (!supplier) throw new ValidationError(`No supplier with id ${supplierId} in this company.`);
  // Phase 38 — same `isActive` guard `requireActiveVatTreatment` above
  // already has for VAT recode; Supplier recode was missing the
  // equivalent check. Fixed here, the one shared validation point both
  // `previewSupplierRecode` and `commitSupplierRecode` call through.
  if (supplier.status !== "Active") throw new ValidationError(`Supplier "${supplier.name}" is inactive and cannot be used.`);
  return supplier;
}

/** Same company-ownership check `assignCustomer`/`allocateRow`'s "C"
 * case already use. */
async function requireCompanyCustomer(companyId: string, customerId: number | undefined | null) {
  if (customerId === undefined || customerId === null) throw new ValidationError("A new customer is required.");
  const customer = await customerRepo.getCustomer(companyId, customerId);
  if (!customer) throw new ValidationError(`No customer with id ${customerId} in this company.`);
  return customer;
}

async function resolveAndValidateSupplier(companyId: string, selection: RecodeSelection, newSupplierId: number) {
  const supplier = await requireCompanySupplier(companyId, newSupplierId);
  const { transactions, eligible, posted } = await resolveSelectionAndSplit(companyId, selection);
  return { supplier, transactions, eligible, posted };
}

async function resolveAndValidateCustomer(companyId: string, selection: RecodeSelection, newCustomerId: number) {
  const customer = await requireCompanyCustomer(companyId, newCustomerId);
  const { transactions, eligible, posted } = await resolveSelectionAndSplit(companyId, selection);
  return { customer, transactions, eligible, posted };
}

async function resolveAndValidateVat(companyId: string, selection: RecodeSelection, newVatCode: string) {
  const treatment = await requireActiveVatTreatment(companyId, newVatCode);
  const { transactions, eligible, posted } = await resolveSelectionAndSplit(companyId, selection);
  return { treatment, transactions, eligible, posted };
}

export type RecodePreviewGroup = { currentAccount: string | null; count: number; totalValue: number };

export type RecodePreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentAccountBreakdown: RecodePreviewGroup[];
  sample: BankTransactionRecord[];
  newGlAccount: { accountCode: string; description: string };
};

/** Read-only — writes nothing. This is the mandatory REVIEW step between
 * SEARCH and CONFIRM (this ticket's own section 4: "Never: SEARCH ->
 * immediately change transactions"). */
export async function previewRecode(companyId: string, selection: RecodeSelection, newGlAccountCode: string): Promise<RecodePreview> {
  const { account, transactions, eligible, posted } = await resolveAndValidate(companyId, selection, newGlAccountCode);

  const groups = new Map<string, RecodePreviewGroup>();
  for (const t of eligible) {
    const key = t.suggestedGlAccount ?? "";
    const value = t.debit || t.credit;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalValue += value;
    } else {
      groups.set(key, { currentAccount: t.suggestedGlAccount, count: 1, totalValue: value });
    }
  }

  return {
    matchingCount: transactions.length,
    eligibleCount: eligible.length,
    postedCount: posted.length,
    estimatedAffectedValue: eligible.reduce((sum, t) => sum + (t.debit || t.credit), 0),
    currentAccountBreakdown: [...groups.values()],
    sample: eligible.slice(0, PREVIEW_SAMPLE_SIZE),
    newGlAccount: { accountCode: account.accountCode, description: account.description },
  };
}

export type RecodeOutcome = {
  requested: number;
  recoded: number;
  skipped: { transactionId: number; reason: string }[];
};

const POSTED_SKIP_REASON = "Already posted to the General Ledger — protected from recoding.";
/** Phase 25I — the message for the narrow race this file's own
 * `resolveAndValidate*` re-check can't close on its own: a transaction
 * posted in the split-second between that re-check and the repository's
 * own write. `repo.bulkRecodeX` now guards this at the DB layer itself
 * (`journal_id IS NULL` repeated in the UPDATE's WHERE clause) and
 * reports back exactly which ids it actually touched — this is the
 * message for anything in `eligible` that comes back NOT updated. */
const POSTED_DURING_COMMIT_SKIP_REASON = "Posted to the General Ledger during this commit — protected from recoding.";

/** Builds the final `RecodeOutcome` from a commit's `eligible`/`posted`
 * split and the repository's own report of which ids it actually
 * updated — anything eligible that didn't come back updated was posted
 * in the race window between re-validation and the write itself, and is
 * reported as skipped rather than silently counted as recoded. */
function buildRecodeOutcome(
  requestedCount: number,
  eligible: { id: number }[],
  posted: { id: number }[],
  updatedIds: number[],
): RecodeOutcome {
  const updatedIdSet = new Set(updatedIds);
  const skipped: RecodeOutcome["skipped"] = [
    ...posted.map((t) => ({ transactionId: t.id, reason: POSTED_SKIP_REASON })),
    ...eligible.filter((t) => !updatedIdSet.has(t.id)).map((t) => ({ transactionId: t.id, reason: POSTED_DURING_COMMIT_SKIP_REASON })),
  ];
  return { requested: requestedCount, recoded: updatedIds.length, skipped };
}

/** The one write path. Re-resolves and re-validates everything preview
 * already checked (never trusts a client-cached preview result as
 * authorization to write) — protects against the selection having
 * changed (e.g. a transaction got posted) between preview and confirm.
 * Delegates the actual write to `repo.bulkRecodeGlAccount` — the SAME
 * `ae_allocation_history`-backed mechanism `bulkAssignGl` already uses,
 * never a parallel one. */
export async function commitRecode(companyId: string, selection: RecodeSelection, newGlAccountCode: string, performedBy: string): Promise<RecodeOutcome> {
  const { transactions, eligible, posted } = await resolveAndValidate(companyId, selection, newGlAccountCode);

  let updatedIds: number[] = [];
  if (eligible.length > 0) {
    ({ updatedIds } = await repo.bulkRecodeGlAccount(companyId, eligible.map((t) => t.id), newGlAccountCode.trim(), performedBy));
  }

  return buildRecodeOutcome(transactions.length, eligible, posted, updatedIds);
}

// ---------------------------------------------------------------------
// Phase 25G — Supplier recode. Same SEARCH -> REVIEW -> PREVIEW -> CONFIRM
// shape as the GL recode above (same `RecodeSelection`, same
// `MAX_RECODE_BATCH_SIZE`, same posted-transaction protection, same
// "commit re-validates, never trusts a cached preview" rule), targeting
// `matched_supplier_id` instead of `suggested_gl_account`.
// ---------------------------------------------------------------------

export type RecodeSupplierPreviewGroup = { currentSupplierId: number | null; currentSupplierName: string | null; count: number; totalValue: number };

export type RecodeSupplierPreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentSupplierBreakdown: RecodeSupplierPreviewGroup[];
  sample: BankTransactionRecord[];
  newSupplier: { id: number; name: string };
};

/** Read-only — writes nothing. */
export async function previewSupplierRecode(companyId: string, selection: RecodeSelection, newSupplierId: number): Promise<RecodeSupplierPreview> {
  const { supplier, transactions, eligible, posted } = await resolveAndValidateSupplier(companyId, selection, newSupplierId);

  const groups = new Map<string, RecodeSupplierPreviewGroup>();
  for (const t of eligible) {
    const key = t.matchedSupplierId !== null ? String(t.matchedSupplierId) : "";
    const value = t.debit || t.credit;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalValue += value;
    } else {
      groups.set(key, { currentSupplierId: t.matchedSupplierId, currentSupplierName: t.matchedSupplierName, count: 1, totalValue: value });
    }
  }

  return {
    matchingCount: transactions.length,
    eligibleCount: eligible.length,
    postedCount: posted.length,
    estimatedAffectedValue: eligible.reduce((sum, t) => sum + (t.debit || t.credit), 0),
    currentSupplierBreakdown: [...groups.values()],
    sample: eligible.slice(0, PREVIEW_SAMPLE_SIZE),
    newSupplier: { id: supplier.id, name: supplier.name },
  };
}

/** The one write path. Re-resolves and re-validates everything preview
 * already checked, including re-confirming the target supplier still
 * belongs to this company — never trusts a client-cached preview result
 * as authorization to write. Delegates to `repo.bulkRecodeSupplier` —
 * the SAME `ae_allocation_history`-backed mechanism `bulkAssignSupplier`
 * already uses, never a parallel one. */
export async function commitSupplierRecode(companyId: string, selection: RecodeSelection, newSupplierId: number, performedBy: string): Promise<RecodeOutcome> {
  const { supplier, transactions, eligible, posted } = await resolveAndValidateSupplier(companyId, selection, newSupplierId);

  let updatedIds: number[] = [];
  if (eligible.length > 0) {
    ({ updatedIds } = await repo.bulkRecodeSupplier(companyId, eligible.map((t) => t.id), supplier.id, supplier.name, performedBy));
  }

  return buildRecodeOutcome(transactions.length, eligible, posted, updatedIds);
}

// ---------------------------------------------------------------------
// Phase 25G — Customer recode. Same shape as supplier recode above,
// targeting `matched_customer_id`.
// ---------------------------------------------------------------------

export type RecodeCustomerPreviewGroup = { currentCustomerId: number | null; currentCustomerName: string | null; count: number; totalValue: number };

export type RecodeCustomerPreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentCustomerBreakdown: RecodeCustomerPreviewGroup[];
  sample: BankTransactionRecord[];
  newCustomer: { id: number; name: string };
};

/** Read-only — writes nothing. `BankTransactionRecord` has no
 * `matchedCustomerName` field (unlike `matchedSupplierName`), so the
 * current-customer breakdown is resolved via one `listCustomers` call —
 * the same existing repository already used elsewhere, not a new
 * lookup mechanism — rather than fetching a name per transaction. */
export async function previewCustomerRecode(companyId: string, selection: RecodeSelection, newCustomerId: number): Promise<RecodeCustomerPreview> {
  const { customer, transactions, eligible, posted } = await resolveAndValidateCustomer(companyId, selection, newCustomerId);

  const allCustomers = await customerRepo.listCustomers(companyId);
  const nameById = new Map(allCustomers.map((c) => [c.id, c.name]));

  const groups = new Map<string, RecodeCustomerPreviewGroup>();
  for (const t of eligible) {
    const key = t.matchedCustomerId !== null ? String(t.matchedCustomerId) : "";
    const value = t.debit || t.credit;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalValue += value;
    } else {
      groups.set(key, { currentCustomerId: t.matchedCustomerId, currentCustomerName: t.matchedCustomerId !== null ? (nameById.get(t.matchedCustomerId) ?? null) : null, count: 1, totalValue: value });
    }
  }

  return {
    matchingCount: transactions.length,
    eligibleCount: eligible.length,
    postedCount: posted.length,
    estimatedAffectedValue: eligible.reduce((sum, t) => sum + (t.debit || t.credit), 0),
    currentCustomerBreakdown: [...groups.values()],
    sample: eligible.slice(0, PREVIEW_SAMPLE_SIZE),
    newCustomer: { id: customer.id, name: customer.name },
  };
}

/** The one write path. Re-resolves and re-validates everything preview
 * already checked, including re-confirming the target customer still
 * belongs to this company. Delegates to `repo.bulkRecodeCustomer` — the
 * SAME `ae_allocation_history`-backed mechanism `bulkAssignCustomer`
 * already uses, never a parallel one. */
export async function commitCustomerRecode(companyId: string, selection: RecodeSelection, newCustomerId: number, performedBy: string): Promise<RecodeOutcome> {
  const { customer, transactions, eligible, posted } = await resolveAndValidateCustomer(companyId, selection, newCustomerId);

  let updatedIds: number[] = [];
  if (eligible.length > 0) {
    ({ updatedIds } = await repo.bulkRecodeCustomer(companyId, eligible.map((t) => t.id), customer.id, customer.name, performedBy));
  }

  return buildRecodeOutcome(transactions.length, eligible, posted, updatedIds);
}

// ---------------------------------------------------------------------
// Phase 25G — VAT recode. Same shape as GL recode (same posted-
// transaction protection, same batch cap, same "commit re-validates"
// rule), targeting `suggested_vat_code` instead of `suggested_gl_account`.
// Confirmed safe by inspection before this was added: `suggested_vat_code`
// is informational only — never read by journal posting (which splits
// VAT from the raw imported `vat` amount, not this code) or by VAT
// Return computation (which reads GL account activity on the VAT
// Input/Output control accounts, fed only by invoices/bills, never by
// bank transactions). A VAT recode therefore carries no more risk than a
// GL recode, and VAT Returns — frozen, stored snapshots, only ever
// recomputed from an explicit action on a Draft return — can never be
// silently affected by this.
// ---------------------------------------------------------------------

export type RecodeVatPreviewGroup = { currentVatCode: string | null; count: number; totalValue: number };

export type RecodeVatPreview = {
  matchingCount: number;
  eligibleCount: number;
  postedCount: number;
  estimatedAffectedValue: number;
  currentVatBreakdown: RecodeVatPreviewGroup[];
  sample: BankTransactionRecord[];
  newVatTreatment: { code: string; name: string };
};

/** Read-only — writes nothing. */
export async function previewVatRecode(companyId: string, selection: RecodeSelection, newVatCode: string): Promise<RecodeVatPreview> {
  const { treatment, transactions, eligible, posted } = await resolveAndValidateVat(companyId, selection, newVatCode);

  const groups = new Map<string, RecodeVatPreviewGroup>();
  for (const t of eligible) {
    const key = t.suggestedVatCode ?? "";
    const value = t.debit || t.credit;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalValue += value;
    } else {
      groups.set(key, { currentVatCode: t.suggestedVatCode, count: 1, totalValue: value });
    }
  }

  return {
    matchingCount: transactions.length,
    eligibleCount: eligible.length,
    postedCount: posted.length,
    estimatedAffectedValue: eligible.reduce((sum, t) => sum + (t.debit || t.credit), 0),
    currentVatBreakdown: [...groups.values()],
    sample: eligible.slice(0, PREVIEW_SAMPLE_SIZE),
    newVatTreatment: { code: treatment.code, name: treatment.name },
  };
}

/** The one write path. Re-resolves and re-validates everything preview
 * already checked, including re-confirming the target VAT treatment is
 * still active. Delegates to `repo.bulkRecodeVat` — the SAME
 * `ae_allocation_history`-backed mechanism `bulkAssignVat` already uses,
 * never a parallel one. */
export async function commitVatRecode(companyId: string, selection: RecodeSelection, newVatCode: string, performedBy: string): Promise<RecodeOutcome> {
  const { treatment, transactions, eligible, posted } = await resolveAndValidateVat(companyId, selection, newVatCode);

  let updatedIds: number[] = [];
  if (eligible.length > 0) {
    ({ updatedIds } = await repo.bulkRecodeVat(companyId, eligible.map((t) => t.id), treatment.code, performedBy));
  }

  return buildRecodeOutcome(transactions.length, eligible, posted, updatedIds);
}
