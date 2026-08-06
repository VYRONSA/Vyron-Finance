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
};

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
export type BankAccountStatus = "Active" | "Inactive" | "Archived";

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
