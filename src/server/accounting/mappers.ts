/**
 * Row <-> domain type mappers for the `ae_*` Supabase tables (see
 * supabase/migrations/0002_supplier_reconciliation.sql). Keeps the
 * repository layer's SQL-shaped rows out of the domain/engine layer.
 */

import type {
  AllocationHistoryEntry,
  AllocationResult,
  BankAccount,
  BankTransactionRecord,
  ImportBatch,
  ImportedBill,
  Journal,
  JournalLine,
  MatchHistoryEntry,
  MatchResult,
  ReviewHistoryEntry,
  ReviewStatus,
  Supplier,
} from "./types";

export type SupplierRow = {
  id: number;
  company_id: string;
  name: string;
  alternative_names: string[];
  default_gl_account: string | null;
  default_vat_code: string | null;
  status: string;
  supplier_code: string;
  supplier_category: string;
  supplier_type: string;
  bank_name: string;
  bank_account_number: string;
  bank_branch_code: string;
  vat_number: string;
  tax_number: string;
  risk_rating: string;
  payment_terms_days: number;
};

export function supplierFromRow(row: SupplierRow): Supplier {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    alternativeNames: row.alternative_names,
    defaultGlAccount: row.default_gl_account,
    defaultVatCode: row.default_vat_code,
    status: row.status === "Inactive" ? "Inactive" : "Active",
    supplierCode: row.supplier_code ?? "",
    supplierCategory: row.supplier_category ?? "",
    supplierType: (row.supplier_type as Supplier["supplierType"]) ?? "Company",
    bankName: row.bank_name ?? "",
    bankAccountNumber: row.bank_account_number ?? "",
    bankBranchCode: row.bank_branch_code ?? "",
    vatNumber: row.vat_number ?? "",
    taxNumber: row.tax_number ?? "",
    riskRating: (row.risk_rating as Supplier["riskRating"]) ?? "Low",
    paymentTermsDays: row.payment_terms_days ?? 30,
  };
}

export type ImportedBillRow = {
  id: number;
  company_id: string;
  supplier_id: number | null;
  supplier_name: string;
  invoice_number: string;
  document_type: string;
  invoice_date: string | null;
  due_date: string | null;
  vat: number;
  total: number;
  outstanding: number;
  status: string;
  gl_account: string | null;
  vat_code: string | null;
  origin: string;
  purchase_order_id: number | null;
  goods_received_note_id: number | null;
  posting_status: string | null;
  journal_id: number | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
};

export function billFromRow(row: ImportedBillRow): ImportedBill {
  return {
    id: row.id,
    companyId: row.company_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number,
    documentType: row.document_type as ImportedBill["documentType"],
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    vat: Number(row.vat),
    total: Number(row.total),
    outstanding: Number(row.outstanding),
    status: row.status,
    glAccount: row.gl_account,
    vatCode: row.vat_code,
    origin: (row.origin as ImportedBill["origin"]) ?? "Imported",
    purchaseOrderId: row.purchase_order_id,
    goodsReceivedNoteId: row.goods_received_note_id,
    postingStatus: row.posting_status as ImportedBill["postingStatus"],
    journalId: row.journal_id,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
  };
}

export type BankTransactionRow = {
  id: number;
  company_id: string;
  transaction_date: string | null;
  reference: string;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  balance: number | null;
  bank_account: string;
  bank_account_id: number | null;
  gl_account: string;
  vat: number | null;
  notes: string;
  import_batch: string;
  source_filename: string;
  created_at: string;
  allocation_status: string;
  matched_supplier_id: number | null;
  matched_bill_id: number | null;
  confidence_score: number | null;
  rules_triggered: string[];
  match_reason: string;
  required_action: string | null;
  suggested_gl_account: string | null;
  suggested_vat_code: string | null;
  allocation_method: string | null;
  allocation_reason: string;
  is_manual_override: boolean;
  review_status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  journal_id: number | null;
  matched_customer_id: number | null;
  matched_merchant_id: number | null;
  rule_id: number | null;
  // Cashbook & Bank Reconciliation (Workflow Completion Audit) — see
  // 0022_cashbook_reconciliation.sql. Reuses this SAME table for manual
  // capture rather than forking a parallel object.
  entry_source: string;
  capture_status: string | null;
  cashbook_batch_id: number | null;
  reconciliation_id: number | null;
  reversal_of_transaction_id: number | null;
  is_split: boolean;
  // Present only when the query embeds the FK-related supplier (see
  // transaction-explorer-repository.ts) — undefined otherwise.
  matched_supplier?: { name: string } | null;
};

export function bankTransactionFromRow(row: BankTransactionRow): BankTransactionRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    transactionDate: row.transaction_date,
    reference: row.reference,
    description: row.description,
    beneficiary: row.beneficiary,
    debit: Number(row.debit),
    credit: Number(row.credit),
    balance: row.balance !== null && row.balance !== undefined ? Number(row.balance) : null,
    bankAccount: row.bank_account,
    bankAccountId: row.bank_account_id,
    glAccount: row.gl_account ?? "",
    vat: row.vat !== null && row.vat !== undefined ? Number(row.vat) : null,
    notes: row.notes ?? "",
    importBatch: row.import_batch ?? "",
    sourceFilename: row.source_filename ?? "",
    createdAt: row.created_at,
    allocationStatus: (row.allocation_status as BankTransactionRecord["allocationStatus"]) ?? "Unallocated",
    matchedSupplierId: row.matched_supplier_id,
    matchedSupplierName: row.matched_supplier?.name ?? null,
    matchedBillId: row.matched_bill_id,
    confidenceScore: row.confidence_score !== null ? Number(row.confidence_score) : null,
    rulesTriggered: row.rules_triggered,
    matchReason: row.match_reason,
    requiredAction: row.required_action,
    suggestedGlAccount: row.suggested_gl_account,
    suggestedVatCode: row.suggested_vat_code,
    allocationMethod: row.allocation_method as BankTransactionRecord["allocationMethod"],
    allocationReason: row.allocation_reason,
    isManualOverride: row.is_manual_override,
    reviewStatus: row.review_status as ReviewStatus | null,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    journalId: row.journal_id,
    matchedCustomerId: row.matched_customer_id,
    matchedMerchantId: row.matched_merchant_id,
    ruleId: row.rule_id,
    entrySource: (row.entry_source as BankTransactionRecord["entrySource"]) ?? "Imported",
    captureStatus: row.capture_status as BankTransactionRecord["captureStatus"],
    cashbookBatchId: row.cashbook_batch_id,
    reconciliationId: row.reconciliation_id,
    reversalOfTransactionId: row.reversal_of_transaction_id,
    isSplit: row.is_split ?? false,
  };
}

/** Fields updated on `ae_bank_transactions` after a Matching Engine pass. */
export function matchResultToUpdate(result: MatchResult) {
  return {
    allocation_status: result.status === "Unmatched" ? "Unallocated" : result.status,
    matched_supplier_id: result.matchedSupplierId,
    matched_bill_id: result.matchedBillId,
    confidence_score: result.confidence,
    rules_triggered: result.rulesTriggered,
    match_reason: result.reason,
    required_action: result.requiredAction,
  };
}

/** Fields updated on `ae_bank_transactions` after an Allocation Engine pass. */
export function allocationResultToUpdate(result: AllocationResult) {
  return {
    allocation_status: result.status,
    suggested_gl_account: result.glAccount,
    suggested_vat_code: result.vatCode,
    allocation_method: result.allocationMethod,
    allocation_reason: result.allocationReason,
    required_action: result.requiredAction,
  };
}

export type BankAccountRow = {
  id: number;
  company_id: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  account_type: string;
  branch: string;
  currency: string;
  status: string;
  opening_balance: number;
  current_balance: number;
  last_reconciliation_date: string | null;
  notes: string;
  created_at: string;
  gl_account: string;
  opening_balance_date: string | null;
  opening_balance_reference: string;
};

export function bankAccountFromRow(row: BankAccountRow): BankAccount {
  return {
    id: row.id,
    companyId: row.company_id,
    accountNumber: row.account_number,
    accountName: row.account_name,
    bankName: row.bank_name,
    accountType: row.account_type,
    branch: row.branch,
    currency: row.currency,
    status: (row.status as BankAccount["status"]) ?? "Active",
    openingBalance: Number(row.opening_balance),
    currentBalance: Number(row.current_balance),
    lastReconciliationDate: row.last_reconciliation_date,
    notes: row.notes,
    createdAt: row.created_at,
    glAccount: row.gl_account ?? "",
    openingBalanceDate: row.opening_balance_date,
    openingBalanceReference: row.opening_balance_reference ?? "",
  };
}

export type ImportBatchRow = {
  id: number;
  company_id: string;
  batch_id: string;
  import_type: string;
  source_filename: string;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  exception_count: number;
  imported_by: string;
  created_at: string;
  bank_account_id: number | null;
  statement_account_holder: string | null;
  statement_account_number: string | null;
  statement_period_start: string | null;
  statement_period_end: string | null;
  statement_opening_balance: number | null;
  statement_closing_balance: number | null;
  balance_reconciles: boolean | null;
};

export function importBatchFromRow(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    companyId: row.company_id,
    batchId: row.batch_id,
    importType: row.import_type === "bank_transactions" ? "bank_transactions" : "bills",
    sourceFilename: row.source_filename,
    rowCount: row.row_count,
    importedCount: row.imported_count,
    duplicateCount: row.duplicate_count,
    exceptionCount: row.exception_count,
    importedBy: row.imported_by,
    createdAt: row.created_at,
    bankAccountId: row.bank_account_id,
    statementAccountHolder: row.statement_account_holder,
    statementAccountNumber: row.statement_account_number,
    statementPeriodStart: row.statement_period_start,
    statementPeriodEnd: row.statement_period_end,
    statementOpeningBalance: row.statement_opening_balance,
    statementClosingBalance: row.statement_closing_balance,
    balanceReconciles: row.balance_reconciles,
  };
}

/** Only these fields may be changed after creation — `account_number` is
 * deliberately excluded, matching `bank_account_service.UPDATABLE_FIELDS`:
 * renumbering would silently break every already-ingested transaction's
 * identity. */
export type BankAccountUpdatableFields = Partial<{
  account_name: string;
  bank_name: string;
  account_type: string;
  branch: string;
  currency: string;
  status: string;
  opening_balance: number;
  current_balance: number;
  last_reconciliation_date: string | null;
  notes: string;
  gl_account: string;
  opening_balance_date: string | null;
  opening_balance_reference: string;
}>;

export type MatchHistoryRow = {
  id: number;
  transaction_id: number;
  previous_status: string | null;
  new_status: string;
  confidence: number | null;
  rules_triggered: string[];
  reason: string;
  performed_by: string;
  created_at: string;
};

export function matchHistoryFromRow(row: MatchHistoryRow): MatchHistoryEntry {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    confidence: row.confidence !== null ? Number(row.confidence) : null,
    rulesTriggered: row.rules_triggered ?? [],
    reason: row.reason,
    performedBy: row.performed_by,
    createdAt: row.created_at,
  };
}

export type AllocationHistoryRow = {
  id: number;
  transaction_id: number;
  previous_status: string | null;
  new_status: string;
  previous_gl_account: string | null;
  new_gl_account: string | null;
  previous_vat_code: string | null;
  new_vat_code: string | null;
  confidence: number | null;
  allocation_method: string;
  allocation_reason: string;
  is_manual_override: boolean;
  performed_by: string;
  created_at: string;
};

export function allocationHistoryFromRow(row: AllocationHistoryRow): AllocationHistoryEntry {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    previousGlAccount: row.previous_gl_account,
    newGlAccount: row.new_gl_account,
    previousVatCode: row.previous_vat_code,
    newVatCode: row.new_vat_code,
    confidence: row.confidence !== null ? Number(row.confidence) : null,
    allocationMethod: row.allocation_method ?? "",
    allocationReason: row.allocation_reason,
    isManualOverride: row.is_manual_override,
    performedBy: row.performed_by,
    createdAt: row.created_at,
  };
}

export type ReviewHistoryRow = {
  id: number;
  transaction_id: number;
  previous_review_status: string | null;
  new_review_status: string;
  note: string;
  performed_by: string;
  created_at: string;
};

export function reviewHistoryFromRow(row: ReviewHistoryRow): ReviewHistoryEntry {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    previousReviewStatus: row.previous_review_status as ReviewStatus | null,
    newReviewStatus: row.new_review_status as ReviewStatus,
    note: row.note,
    performedBy: row.performed_by,
    createdAt: row.created_at,
  };
}

export type JournalLineRow = {
  id: number;
  journal_id: number;
  account_code: string;
  debit: number;
  credit: number;
  description: string;
  line_order: number;
};

export function journalLineFromRow(row: JournalLineRow): JournalLine {
  return {
    id: row.id,
    journalId: row.journal_id,
    accountCode: row.account_code,
    debit: Number(row.debit),
    credit: Number(row.credit),
    description: row.description,
    lineOrder: row.line_order,
  };
}

export type JournalRow = {
  id: number;
  company_id: string;
  journal_number: string;
  journal_date: string;
  journal_type: string;
  description: string;
  reference: string;
  source_type: string;
  source_id: number | null;
  status: string;
  total_debit: number;
  total_credit: number;
  created_at: string;
  posted_at: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  is_reversed: boolean;
  reversal_of_journal_id: number | null;
  reversed_by_journal_id: number | null;
  posting_batch_id: number | null;
  ae_journal_lines?: JournalLineRow[];
};

export function journalFromRow(row: JournalRow): Journal {
  return {
    id: row.id,
    companyId: row.company_id,
    journalNumber: row.journal_number,
    journalDate: row.journal_date,
    journalType: row.journal_type,
    description: row.description,
    reference: row.reference,
    sourceType: row.source_type,
    sourceId: row.source_id,
    status: (row.status as Journal["status"]) ?? "Draft",
    totalDebit: Number(row.total_debit),
    totalCredit: Number(row.total_credit),
    createdAt: row.created_at,
    postedAt: row.posted_at,
    submittedBy: row.submitted_by ?? null,
    submittedAt: row.submitted_at ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    rejectedBy: row.rejected_by ?? null,
    rejectedAt: row.rejected_at ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    isReversed: row.is_reversed ?? false,
    reversalOfJournalId: row.reversal_of_journal_id ?? null,
    reversedByJournalId: row.reversed_by_journal_id ?? null,
    postingBatchId: row.posting_batch_id ?? null,
    lines: (row.ae_journal_lines ?? []).map(journalLineFromRow).sort((a, b) => a.lineOrder - b.lineOrder),
  };
}
