/**
 * Domain types for the Supplier Reconciliation module — ported from the
 * reference implementation's `accounting_engine/models.py` (the "current/
 * primary" stack behind `ui/reconciliation_centre_screen.py`, not the
 * legacy `matching/`+`database/` stack `recovery/status.py` reads today —
 * see docs/MIGRATION_ROADMAP.md for that distinction). Field names and
 * shapes are kept identical to the Python dataclasses so this stays a
 * faithful port, not a redesign.
 */

// Fields below `status` are new (Commercial Platform Module 2 — Supplier
// Management), not part of the reference dataclass — genuinely new
// capability, disclosed as such rather than silently invented, same
// convention as `BankAccount.glAccount`.
export type SupplierType = "Company" | "Individual";
export type SupplierRiskRating = "Low" | "Medium" | "High";

export type Supplier = {
  id: number;
  companyId: string;
  name: string;
  alternativeNames: string[];
  defaultGlAccount: string | null;
  defaultVatCode: string | null;
  status: "Active" | "Inactive";
  supplierCode: string;
  supplierCategory: string;
  supplierType: SupplierType;
  bankName: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  vatNumber: string;
  taxNumber: string;
  riskRating: SupplierRiskRating;
  paymentTermsDays: number;
  // Finding #154 — the AP-side equivalent of Customer.creditLimit; 0
  // means "no limit configured," same convention #036 established.
  spendingLimit: number;
};

/** "Bill/Credit Note" status is the pre-existing, unconstrained
 * reconciliation-side status (imported bills only ever show 'Open').
 * "Posting" fields are additive (Purchasing Platform, Module 4) — `null`
 * for every bill that predates or falls outside the new posting workflow
 * (all imported bills, by default); real values only for bills that have
 * explicitly entered it. See `0011_purchasing_platform.sql`'s header
 * comment for the full reasoning — this is a deliberate field-level
 * honesty boundary, not a placeholder. */
export type BillOrigin = "Imported" | "Purchasing";
export type BillPostingStatus = "Draft" | "Submitted" | "Approved" | "Posted" | "Cancelled";

export type ImportedBill = {
  id: number;
  companyId: string;
  supplierId: number | null;
  supplierName: string;
  invoiceNumber: string;
  documentType: "Bill" | "Credit Note" | "Debit Note";
  invoiceDate: string | null;
  dueDate: string | null;
  vat: number;
  total: number;
  outstanding: number;
  currency: string;
  status: string;
  glAccount: string | null;
  vatCode: string | null;
  origin: BillOrigin;
  purchaseOrderId: number | null;
  goodsReceivedNoteId: number | null;
  postingStatus: BillPostingStatus | null;
  journalId: number | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
};

// "Additional Requirement: Purchase Processing" — a Bill/Credit Note/
// Debit Note entered through Purchasing may optionally carry line
// items; the header's own gl_account/vat_code/vat/total stay real
// roll-ups computed from these when present (see 0059's own comment).
export type PurchaseBillLine = {
  id: number;
  companyId: string;
  billId: number;
  lineOrder: number;
  description: string;
  glAccount: string;
  vatCode: string;
  costCentreId: number | null;
  projectId: number | null;
  departmentId: number | null;
  quantity: number;
  unitCost: number;
  discount: number;
  netAmount: number;
  vatAmount: number;
  lineTotal: number;
  createdAt: string;
};

// 'Allocated' is an Allocation-Engine-only outcome layered on top of the
// Matching Engine's own three-way Matched/Suggested/Unallocated status —
// see allocation-engine.ts's module docstring.
export type AllocationStatus = "Matched" | "Allocated" | "Suggested" | "Unallocated";

export type ReviewStatus = "Approved" | "Rejected" | "Ignored";

export type BankTransactionRecord = {
  id: number;
  companyId: string;
  transactionDate: string | null;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  balance: number | null;
  bankAccount: string;
  bankAccountId: number | null;
  // As-imported values (bank statement's own GL Account/VAT/Notes
  // columns) — distinct from the Allocation Engine's suggestedGlAccount/
  // suggestedVatCode below.
  glAccount: string;
  vat: number | null;
  notes: string;
  importBatch: string;
  sourceFilename: string;
  createdAt: string;

  allocationStatus: AllocationStatus;
  matchedSupplierId: number | null;
  matchedSupplierName: string | null;
  matchedBillId: number | null;
  confidenceScore: number | null;
  rulesTriggered: string[];
  matchReason: string;
  requiredAction: string | null;
  suggestedGlAccount: string | null;
  suggestedVatCode: string | null;
  allocationMethod: AllocationMethod | null;
  allocationReason: string;
  isManualOverride: boolean;

  reviewStatus: ReviewStatus | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;

  journalId: number | null;

  // Banking Automation & Rule Intelligence Platform (Module 6) additions —
  // extends this table rather than duplicating it. matchedSupplierId
  // above stays the Matching/Allocation Engines' own field; these three
  // are the Rule Engine's.
  matchedCustomerId: number | null;
  matchedMerchantId: number | null;
  ruleId: number | null;

  // Transaction Explorer Redesign, Phase 1 (Bank Transaction Allocation
  // Workspace) — the discriminator the inline grid's Type column reads/
  // writes, since matchedSupplierId/matchedCustomerId/suggestedGlAccount
  // above are not mutually exclusive on their own (see migration
  // 0062's header comment). allocationNotes is a NEW accountant-entered
  // field, deliberately separate from the as-imported `notes` above.
  allocationType: "G" | "C" | "S" | null;
  allocationNotes: string;

  // Cashbook & Bank Reconciliation (Workflow Completion Audit) additions
  // — this SAME table reused for manually-captured entries, not a
  // parallel object. `captureStatus` is only meaningful when
  // `entrySource === "Manual"`; an `Imported` row's lifecycle stays
  // `reviewStatus`/`journalId` as before, unchanged.
  entrySource: "Imported" | "Manual";
  captureStatus: "Draft" | "Submitted" | "Approved" | "Posted" | "Cancelled" | null;
  cashbookBatchId: number | null;
  reconciliationId: number | null;
  reversalOfTransactionId: number | null;

  // Matching Platform (Module 14) addition — true once this transaction
  // has real `bank_transaction_splits` rows; see `matching/types.ts`.
  isSplit: boolean;

  // Bank Accounting Posting (migration 0092). `journalId` alone was never
  // enough to answer "has this entered the General Ledger?": a journal
  // can exist as a Draft that was never posted. `postedFlag` is set by
  // the posting engine at the same instant the `gl_transactions` rows are
  // written, and `postingBatchId` names the batch that wrote them, so a
  // posted row is traceable forward to its ledger entries and every
  // ledger entry is traceable back to the bank transaction it came from.
  postedFlag: boolean;
  postedAt: string | null;
  postingBatchId: number | null;

  // Human-review hold (migration 0094). A person holding a transaction
  // for review outranks every automatic classifier: the AI sweep, any
  // automatic GL suggestion, and any automatic VAT assignment must all
  // leave it alone. Deliberately separate from `reviewStatus` (the
  // human's DECISION) and from the allocation fields (what the account
  // currently is) — a hold says only "a person is dealing with this".
  reviewHold: boolean;
  reviewHoldReason: string;
  reviewHoldBy: string | null;
  reviewHoldAt: string | null;

  // Supplier Invoice Matching Override (migration 0095). The
  // accountant's explicit confirmation that this supplier payment may
  // post without a linked supplier invoice. It lifts exactly one
  // requirement and nothing else — it is not a match, not an invoice,
  // and not a classification.
  overrideSupplierInvoiceMatching: boolean;
  overrideSupplierInvoiceMatchingBy: string | null;
  overrideSupplierInvoiceMatchingAt: string | null;

  // See `import-source-occurrence.ts` — this row's ordinal among
  // identical rows in the source it was imported from. Surfaced on the
  // record so the Explorer can show an accountant that two look-alike
  // rows are two genuinely separate source records, not an import bug.
  sourceOccurrence: number;
};

/**
 * The four states the banking workflow distinguishes, in order. Assigning
 * a GL account is NOT posting: a classified transaction has been told
 * where it belongs, a posted one has actually moved the ledger. Derived
 * from real rows (`posted_flag`, `reconciliation_id`, the allocation
 * fields) rather than stored as a status column that could drift out of
 * step with the ledger it claims to describe.
 */
export type TransactionPostingStatus = "Unprocessed" | "Ready to Post" | "Posted" | "Reconciled";

/**
 * "Is a person dealing with this?" — the single definition of held for
 * human review, shared by the pure eligibility check, the sweep's
 * candidate query and the database write guard, so the three can never
 * disagree about what a hold means.
 *
 * An explicit hold is only one of the three ways this is true: a
 * recorded review decision and a system-raised required action both mean
 * a human is (or must be) involved, and an automatic classifier must not
 * overwrite either.
 */
export function isHeldForHumanReview(
  t: Pick<BankTransactionRecord, "reviewHold" | "reviewStatus" | "requiredAction">,
): boolean {
  return t.reviewHold || t.reviewStatus !== null || t.requiredAction !== null;
}

/**
 * Is this transaction subject to supplier invoice matching?
 *
 * Only a payment (money out) that VYRON has actually identified as
 * belonging to a supplier — either the Matching Engine resolved one, or
 * the accountant allocated it as type "S". A payment allocated straight
 * to a GL account is not a supplier-ledger movement and has no invoice
 * to match, so the requirement does not apply to it.
 */
export function isSubjectToSupplierInvoiceMatching(
  t: Pick<BankTransactionRecord, "debit" | "matchedSupplierId" | "allocationType">,
): boolean {
  return t.debit > 0 && (t.matchedSupplierId !== null || t.allocationType === "S");
}

/**
 * The three-way eligibility the posting preflight enforces:
 *   invoice matched                 -> satisfied
 *   no invoice, override enabled    -> satisfied (explicit accountant decision)
 *   no invoice, no override         -> NOT satisfied
 */
export function satisfiesSupplierInvoiceMatching(
  t: Pick<BankTransactionRecord, "debit" | "matchedSupplierId" | "allocationType" | "matchedBillId" | "overrideSupplierInvoiceMatching">,
): boolean {
  if (!isSubjectToSupplierInvoiceMatching(t)) return true;
  return t.matchedBillId !== null || t.overrideSupplierInvoiceMatching;
}

export const SUPPLIER_INVOICE_MATCHING_REQUIRED_REASON =
  'Supplier invoice matching required — either link a supplier invoice or enable "Override Supplier Invoice Matching".';

/**
 * "Does VYRON know where this transaction belongs?" — the single
 * difference between Unprocessed and Ready to Post.
 *
 * Three ways a transaction can have a known destination:
 *   1. a GL account was allocated to it directly;
 *   2. it was split across several GL accounts;
 *   3. it was allocated to a SUBSIDIARY LEDGER — a payment to a supplier
 *      or a receipt from a customer. There is no expense/income account
 *      to pick in that case: the entry hits the Creditors or Debtors
 *      control account, which the company's own "Supplier Payment" /
 *      "Customer Receipt" posting rules already name.
 *
 * (3) is the fix for a production defect: allocating a payment to a
 * supplier left the transaction permanently Unprocessed, so "Post to
 * Accounting" never enabled and 194 genuinely-allocated Northwood
 * transactions could not be posted at all.
 *
 * An unconfirmed suggestion counts here exactly as it always has for the
 * GL side (a `Suggested` row with a `suggested_gl_account` has always
 * been Ready to Post) — being ready to post is not the same as being
 * posted, and every posting guard downstream still applies, including
 * supplier invoice matching.
 *
 * MUST STAY IN AGREEMENT WITH the `is_allocated` generated column
 * (migration 0096, superseding 0092) — the filter behind the Posting
 * Status dropdown is that column, and the badge in the grid is this
 * function. They are derived from the same four columns for exactly that
 * reason.
 */
export function isAllocatedForPosting(
  t: Pick<BankTransactionRecord, "suggestedGlAccount" | "isSplit" | "allocationType" | "matchedSupplierId" | "matchedCustomerId">,
): boolean {
  if ((t.suggestedGlAccount?.trim() ?? "") !== "") return true;
  if (t.isSplit) return true;
  if (t.allocationType === "S" && t.matchedSupplierId !== null) return true;
  if (t.allocationType === "C" && t.matchedCustomerId !== null) return true;
  return false;
}

/**
 * Does this transaction still count as ALLOCATED work?
 *
 * Allocation status ("Matched"/"Allocated"/"Suggested"/"Unallocated") and
 * posting status are two different axes, and for most of the workflow
 * they genuinely are independent. But POSTING IS TERMINAL: once a
 * transaction has entered the General Ledger, "Allocated" is no longer
 * where an accountant expects to find it — it is Posted. Counting it in
 * both buckets makes the page totals overlap and overstates what is left
 * to do, which is exactly what was reported: a page showing
 * "Allocated 50 ... Ready to Post 48 | Posted 2", where the 2 posted rows
 * were still sitting inside the 50.
 *
 * Reconciled implies posted, and is treated the same way.
 */
export function countsAsAllocated(
  t: Pick<BankTransactionRecord, "allocationStatus" | "postedFlag" | "reconciliationId">,
): boolean {
  if (t.postedFlag || t.reconciliationId !== null) return false;
  return t.allocationStatus === "Allocated" || t.allocationStatus === "Matched";
}

/**
 * Should a filter on the ALLOCATION axis hide transactions that have
 * already been posted?
 *
 * Yes by default — ticking "Allocated" and being handed rows that are
 * already in the ledger is the same overlap as the counter above. But
 * never when the accountant has explicitly asked for posted or reconciled
 * transactions on the posting axis: that is a deliberate request to see
 * them, and silently returning nothing would be worse than the overlap.
 */
export function allocationFilterExcludesPosted(
  filters: Pick<TransactionExplorerFilters, "postingStatuses">,
): boolean {
  const requested = filters.postingStatuses ?? [];
  return !requested.includes("Posted") && !requested.includes("Reconciled");
}

export function transactionPostingStatus(
  t: Pick<
    BankTransactionRecord,
    "postedFlag" | "reconciliationId" | "suggestedGlAccount" | "isSplit" | "allocationType" | "matchedSupplierId" | "matchedCustomerId"
  >,
): TransactionPostingStatus {
  if (t.reconciliationId !== null) return "Reconciled";
  if (t.postedFlag) return "Posted";
  return isAllocatedForPosting(t) ? "Ready to Post" : "Unprocessed";
}

export function isPayment(t: Pick<BankTransactionRecord, "debit">) {
  return t.debit > 0;
}

export function isReceipt(t: Pick<BankTransactionRecord, "credit">) {
  return t.credit > 0;
}

export type PaymentType = "Full Payment" | "Partial Payment";

export type MatchResult = {
  bankTransactionId: number;
  status: "Matched" | "Suggested" | "Unmatched";
  matchedSupplierId: number | null;
  matchedBillId: number | null;
  confidence: number;
  rulesTriggered: string[];
  reason: string;
  paymentType: PaymentType | null;
  requiredAction: string | null;
  candidateBillIds: number[];
};

export type AllocationMethod = "Matched Bill" | "Supplier Default" | "Manual" | "Future AI";

export type AllocationResult = {
  bankTransactionId: number;
  status: "Matched" | "Allocated" | "Suggested" | "Unallocated";
  supplierId: number | null;
  glAccount: string | null;
  vatCode: string | null;
  confidence: number;
  allocationMethod: AllocationMethod | null;
  allocationReason: string;
  requiredAction: string | null;
};

// Ported from `accounting_engine/models.py::BankAccount` /
// `bank_account_service.UPDATABLE_FIELDS` (Migration Roadmap Module 2).
// Finding #078 — "Inactive" was a real, DB-constraint-legal value with
// its own badge styling defined, but no code path ever wrote it: Active
// and Archived (Archive/Reactivate) are the only two states the app
// actually uses. Removed rather than built out, since Archive/Reactivate
// already covers the practical need — see migration 0066.
export type BankAccountStatus = "Active" | "Archived";

export type BankAccount = {
  id: number;
  companyId: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  accountType: string;
  branch: string;
  currency: string;
  status: BankAccountStatus;
  openingBalance: number;
  currentBalance: number;
  lastReconciliationDate: string | null;
  notes: string;
  createdAt: string | null;
  // The control-account GL code Journal generation debits/credits
  // against for this account's "bank side" — see journal-service.ts.
  glAccount: string;
  // Pilot Review Round 1, Phase 2 — editable post-creation, distinct
  // from `openingBalance`'s original creation-time value semantics.
  openingBalanceDate: string | null;
  openingBalanceReference: string;
};

// Import Centre module (Migration Roadmap Module 3) — real import history,
// which the reference app never persisted (`import_batch` was a bare
// string column with no table tracking the file it came from).
export type ImportBatch = {
  id: number;
  companyId: string;
  batchId: string;
  importType: "bills" | "bank_transactions";
  sourceFilename: string;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  exceptionCount: number;
  importedBy: string;
  createdAt: string;
  /** Pilot Review Round 1 — PDF Bank Statement Import. Populated only
   * for a PDF bank-statement batch; `null` for every other import type
   * and format, which don't carry statement-level facts. */
  bankAccountId: number | null;
  statementAccountHolder: string | null;
  statementAccountNumber: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  statementOpeningBalance: number | null;
  statementClosingBalance: number | null;
  balanceReconciles: boolean | null;
};

/** Ported from `BankAccountSummary` — the aggregate figures computed
 * live from `ae_bank_transactions`, never stored. */
export type BankAccountSummary = {
  account: BankAccount;
  statementCount: number;
  transactionCount: number;
  transactionCountCapped: boolean;
  totalDebits: number;
  totalCredits: number;
  lastImport: string | null;
  matched: number;
  suggested: number;
  unallocated: number;
};

// Transaction Explorer module (Migration Roadmap Module 6).

/** Company-wide, not scoped to the grid's current filters — matches
 * every other `ExecutiveSummaryBar` in the app. Computed DB-side via
 * `fn_transaction_explorer_summary` (see 0005_transaction_explorer.sql)
 * since it must stay correct at 100,000+ rows without loading them. */
export type TransactionExplorerSummary = {
  totalTransactions: number;
  matched: number;
  unmatched: number;
  awaitingReview: number;
  journalsCreated: number;
  totalValue: number;
};

export type TransactionSortColumn = "transactionDate" | "debit" | "credit";
export type SortDirection = "asc" | "desc";

export type TransactionExplorerFilters = {
  search: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  statuses: AllocationStatus[] | null;
  bankAccountId: number | null;
  importBatch: string | null;
  duplicateOnly: boolean;
  unknownSupplierOnly: boolean;
  sortBy: TransactionSortColumn;
  sortDirection: SortDirection;
  /** Phase 23A (Find & Recode) — additive, optional filter fields over
   * columns that already existed on `ae_bank_transactions` (no migration
   * needed). Optional (not required) so every existing construction site
   * of this type — `parseFilters`, tests, `EMPTY_FILTER_DRAFT`, mock data
   * — stays valid unchanged; an absent field is simply "not applied",
   * same as `null` for the fields above. A precise `description`/
   * `reference` filter (AND-combined with everything else) is distinct
   * from the existing `search` field above (which OR-matches across
   * description/reference/beneficiary/notes) — Find & Recode needs the
   * precise, ANDable form for its "Description contains X AND Current
   * account is Y" use case. */
  description?: string | null;
  reference?: string | null;
  glAccount?: string | null;
  supplierId?: number | null;
  customerId?: number | null;
  allocationMethods?: AllocationMethod[] | null;
  /** `true` = only transactions a Banking Rule touched (`rule_id is not
   * null`); `false` = only transactions no rule ever touched; `null`/
   * absent = no filter on this. */
  hasRule?: boolean | null;
  manualOverrideOnly?: boolean;
  needsReviewOnly?: boolean;
  /** Bank Accounting Posting — filter by where a transaction sits in the
   * IMPORT -> CLASSIFY -> POST -> RECONCILE workflow. Expressed over the
   * same real columns `transactionPostingStatus` derives from, so the
   * filter and the badge in the grid can never disagree. */
  postingStatuses?: TransactionPostingStatus[] | null;
};

/** Opaque to callers — encodes the keyset cursor's sort-column value + id
 * tiebreaker. See `transaction-explorer-service.ts::encodeCursor`. */
export type TransactionExplorerCursor = {
  sortValue: string | number | null;
  id: number;
};

export type TransactionExplorerPage = {
  transactions: BankTransactionRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type MatchHistoryEntry = {
  id: number;
  transactionId: number;
  previousStatus: string | null;
  newStatus: string;
  confidence: number | null;
  rulesTriggered: string[];
  reason: string;
  performedBy: string;
  createdAt: string;
};

export type AllocationHistoryEntry = {
  id: number;
  transactionId: number;
  previousStatus: string | null;
  newStatus: string;
  previousGlAccount: string | null;
  newGlAccount: string | null;
  previousVatCode: string | null;
  newVatCode: string | null;
  confidence: number | null;
  allocationMethod: string;
  allocationReason: string;
  isManualOverride: boolean;
  performedBy: string;
  createdAt: string;
};

export type ReviewHistoryEntry = {
  id: number;
  transactionId: number;
  previousReviewStatus: ReviewStatus | null;
  newReviewStatus: ReviewStatus;
  note: string;
  performedBy: string;
  createdAt: string;
};

export type TransactionDetail = {
  transaction: BankTransactionRecord;
  bankAccount: BankAccount | null;
  matchedSupplier: Supplier | null;
  matchedCustomer: import("@/server/customer-management/types").Customer | null;
  matchedMerchant: import("@/server/banking-rules/types").Merchant | null;
  journal: Journal | null;
  matchHistory: MatchHistoryEntry[];
  allocationHistory: AllocationHistoryEntry[];
  reviewHistory: ReviewHistoryEntry[];
};

// Journal generation (Draft creation — ported from `accounting_engine`'s
// JournalService). The workflow states beyond Draft/Approved/Rejected/
// Posted (Submitted, Cancelled) and the audit-stamp columns below are new,
// added for General Ledger (Module 10) — see
// `supabase/migrations/0007_general_ledger.sql` and
// `services/journal-workflow-service.ts`. `Reversed` is deliberately not a
// 7th status: it's the `isReversed` flag below, layered on top of the
// reference's real mechanic (a brand-new offsetting journal), not a
// rewrite of it.
export type JournalStatus = "Draft" | "Submitted" | "Approved" | "Rejected" | "Posted" | "Cancelled";

export type JournalLine = {
  id: number;
  journalId: number;
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
  lineOrder: number;
};

export type Journal = {
  id: number;
  companyId: string;
  journalNumber: string;
  journalDate: string;
  journalType: string;
  description: string;
  reference: string;
  sourceType: string;
  sourceId: number | null;
  status: JournalStatus;
  totalDebit: number;
  totalCredit: number;
  createdAt: string;
  postedAt: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  isReversed: boolean;
  reversalOfJournalId: number | null;
  reversedByJournalId: number | null;
  postingBatchId: number | null;
  lines: JournalLine[];
};
