/**
 * Preview Mode seed data for Transaction Explorer. Field shapes match the
 * real domain types exactly. The summary tile numbers are computed from
 * the same transaction list (not hand-typed), so Preview Mode stays
 * internally consistent the same way Supplier Reconciliation's mock data
 * does.
 */

import type {
  AllocationHistoryEntry,
  BankTransactionRecord,
  Journal,
  MatchHistoryEntry,
  ReviewHistoryEntry,
  TransactionDetail,
  TransactionExplorerSummary,
} from "@/server/accounting/types";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import { MOCK_COMPANY } from "./financial-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "./bank-accounts-data";

const COMPANY_ID = MOCK_COMPANY.id;

function txn(overrides: Partial<BankTransactionRecord> & Pick<BankTransactionRecord, "id">): BankTransactionRecord {
  return {
    companyId: COMPANY_ID,
    transactionDate: "2026-07-01",
    reference: "",
    description: "",
    beneficiary: "",
    debit: 0,
    credit: 0,
    balance: null,
    bankAccount: "62050837304",
    bankAccountId: 1,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "BATCH-20260729143200",
    sourceFilename: "BankImport_Standard_July.csv",
    createdAt: "2026-07-29T14:32:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

export const MOCK_TRANSACTIONS: BankTransactionRecord[] = [
  txn({
    id: 501, reference: "REF-3381", description: "Payment INV-3381", beneficiary: "Fenwick Office Supplies",
    debit: 612.5, balance: 412650.75, matchedSupplierId: 1, matchedSupplierName: "Fenwick Office Supplies", matchedBillId: 1,
    allocationStatus: "Matched", confidenceScore: 98, rulesTriggered: ["Exact Supplier Name", "Exact Amount"],
    matchReason: "Matched on exact supplier name and exact outstanding amount.",
    suggestedGlAccount: "6100 — Office Supplies", suggestedVatCode: "Standard", allocationMethod: "Matched Bill",
    transactionDate: "2026-07-29",
  }),
  txn({
    id: 500, reference: "REF-9042", description: "June freight", beneficiary: "Netherfield Freight Ltd",
    debit: 1470, balance: 411180.75, matchedSupplierId: 2, matchedSupplierName: "Netherfield Freight Ltd", matchedBillId: 2,
    allocationStatus: "Matched", confidenceScore: 98, rulesTriggered: ["Exact Supplier Name", "Exact Amount"],
    matchReason: "Matched on exact supplier name and exact outstanding amount.",
    suggestedGlAccount: "6200 — Distribution", suggestedVatCode: "Standard", allocationMethod: "Matched Bill",
    journalId: 1, transactionDate: "2026-07-29",
  }),
  txn({
    id: 499, reference: "REF-CARD", description: "Till 4 settlement", beneficiary: "Card Settlement",
    credit: 3240.75, balance: 414421.5, allocationStatus: "Unallocated", confidenceScore: 0,
    matchReason: "No supplier found matching beneficiary 'Card Settlement'.", transactionDate: "2026-07-28",
  }),
  txn({
    id: 498, reference: "REF-HP118", description: "Part payment HP-118", beneficiary: "Harrow Print & Design",
    debit: 150, balance: 414271.5, matchedSupplierId: 3, matchedSupplierName: "Harrow Print & Design", matchedBillId: 3,
    allocationStatus: "Suggested", confidenceScore: 45, rulesTriggered: ["Alternative Supplier Name"],
    matchReason: "Partial payment against outstanding bill HP-118 — amount does not match exactly.",
    requiredAction: "Review — confidence below auto-match threshold", transactionDate: "2026-07-28",
  }),
  txn({
    id: 497, reference: "REF-88213", description: "Unknown EFT", beneficiary: "REF 88213 EFT",
    debit: 240, balance: 414421.5, allocationStatus: "Unallocated", confidenceScore: 0,
    matchReason: "No supplier found matching beneficiary 'REF 88213 EFT'.", transactionDate: "2026-07-27",
  }),
  txn({
    id: 496, reference: "REF-9042-B", description: "June freight (second run)", beneficiary: "Netherfield Freight Ltd",
    debit: 1470, balance: 415891.5, matchedSupplierId: 2, matchedSupplierName: "Netherfield Freight Ltd", matchedBillId: 2,
    allocationStatus: "Suggested", confidenceScore: 55, rulesTriggered: ["Exact Supplier Name"],
    matchReason: "Exact supplier name match, but bill NF-9042 already has a matched payment.",
    requiredAction: REQUIRED_ACTION_DUPLICATE_PAYMENT, transactionDate: "2026-07-26",
  }),
  txn({
    id: 495, reference: "REF-STAFF", description: "July payroll run", beneficiary: "Staff Payroll",
    debit: 84200, balance: 417361.5, bankAccount: "1961234567", bankAccountId: 2,
    allocationStatus: "Allocated", confidenceScore: 60, allocationMethod: "Supplier Default",
    suggestedGlAccount: "7000 — Salaries & Wages", suggestedVatCode: "Exempt",
    reviewStatus: "Approved", reviewedBy: "finance@harlowretail.co.za", reviewedAt: "2026-07-23T09:12:00Z",
    reviewNote: "Confirmed against payroll register.", transactionDate: "2026-07-22",
  }),
  txn({
    id: 494, reference: "REF-CLEAN", description: "Monthly cleaning", beneficiary: "Unregistered Cleaning Co",
    debit: 240, balance: 418240, allocationStatus: "Unallocated", confidenceScore: 0,
    matchReason: "No supplier found matching beneficiary 'Unregistered Cleaning Co'.",
    reviewStatus: "Ignored", reviewedBy: "finance@harlowretail.co.za", reviewedAt: "2026-07-06T11:00:00Z",
    reviewNote: "Below materiality threshold — not worth chasing.", transactionDate: "2026-07-05",
  }),
];

function computeSummary(transactions: BankTransactionRecord[]): TransactionExplorerSummary {
  return {
    totalTransactions: transactions.length,
    matched: transactions.filter((t) => t.allocationStatus === "Matched" || t.allocationStatus === "Allocated").length,
    unmatched: transactions.filter((t) => t.allocationStatus === "Unallocated").length,
    awaitingReview: transactions.filter((t) => t.allocationStatus === "Suggested" && t.reviewStatus === null).length,
    journalsCreated: transactions.filter((t) => t.journalId !== null).length,
    totalValue: Math.round(transactions.reduce((sum, t) => sum + t.debit + t.credit, 0) * 100) / 100,
  };
}

export const MOCK_TRANSACTION_SUMMARY: TransactionExplorerSummary = computeSummary(MOCK_TRANSACTIONS);

const MOCK_JOURNAL: Journal = {
  id: 1,
  companyId: COMPANY_ID,
  journalNumber: "JR000001",
  journalDate: "2026-07-29",
  journalType: "Bank Transactions",
  description: "Generated from 1 transaction(s)",
  reference: "",
  sourceType: "bank_transactions_bulk",
  sourceId: null,
  status: "Draft",
  totalDebit: 1470,
  totalCredit: 1470,
  createdAt: "2026-07-29T15:00:00Z",
  postedAt: null,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  isReversed: false,
  reversalOfJournalId: null,
  reversedByJournalId: null,
  postingBatchId: null,
  lines: [
    { id: 1, journalId: 1, accountCode: "6200 — Distribution", debit: 1470, credit: 0, description: "June freight", lineOrder: 0 },
    { id: 2, journalId: 1, accountCode: "1000 — Bank Current Account", debit: 0, credit: 1470, description: "June freight", lineOrder: 1 },
  ],
};

const MOCK_MATCH_HISTORY: MatchHistoryEntry[] = [
  {
    id: 1, transactionId: 500, previousStatus: null, newStatus: "Matched", confidence: 98,
    rulesTriggered: ["Exact Supplier Name", "Exact Amount"], reason: "Matched on exact supplier name and exact outstanding amount.",
    performedBy: "System", createdAt: "2026-07-29T14:35:00Z",
  },
];

const MOCK_ALLOCATION_HISTORY: AllocationHistoryEntry[] = [
  {
    id: 1, transactionId: 500, previousStatus: "Unallocated", newStatus: "Matched", previousGlAccount: null,
    newGlAccount: "6200 — Distribution", previousVatCode: null, newVatCode: "Standard", confidence: 98,
    allocationMethod: "Matched Bill", allocationReason: "Allocated from matched bill NF-9042.",
    isManualOverride: false, performedBy: "System", createdAt: "2026-07-29T14:35:05Z",
  },
];

const MOCK_REVIEW_HISTORY: ReviewHistoryEntry[] = [
  {
    id: 1, transactionId: 495, previousReviewStatus: null, newReviewStatus: "Approved",
    note: "Confirmed against payroll register.", performedBy: "finance@harlowretail.co.za", createdAt: "2026-07-23T09:12:00Z",
  },
];

export const MOCK_TRANSACTION_DETAILS: Record<number, TransactionDetail> = Object.fromEntries(
  MOCK_TRANSACTIONS.map((transaction) => [
    transaction.id,
    {
      transaction,
      bankAccount: MOCK_BANK_ACCOUNT_SUMMARIES.find((s) => s.account.id === transaction.bankAccountId)?.account ?? null,
      matchedSupplier: null,
      matchedCustomer: null,
      matchedMerchant: null,
      journal: transaction.journalId === 1 ? MOCK_JOURNAL : null,
      matchHistory: MOCK_MATCH_HISTORY.filter((h) => h.transactionId === transaction.id),
      allocationHistory: MOCK_ALLOCATION_HISTORY.filter((h) => h.transactionId === transaction.id),
      reviewHistory: MOCK_REVIEW_HISTORY.filter((h) => h.transactionId === transaction.id),
    },
  ]),
);

/** Preview Mode's equivalent of the real `fn_banking_automation_summary()`
 * aggregate (Launch Blocker fix, post-RC2) — derived from `MOCK_TRANSACTIONS`
 * itself, never hand-typed, so it can't drift from the array it stands in
 * for. Shared by the Executive Dashboard, Automation Dashboard, and
 * Matching pages — the same 3 real pages that call the real aggregate. */
export const MOCK_BANKING_AGGREGATE = (() => {
  const imported = MOCK_TRANSACTIONS.filter((t) => t.entrySource === "Imported");
  const ruleApplied = imported.filter((t) => t.ruleId !== null);
  const withConfidence = imported.filter((t) => t.confidenceScore !== null);
  return {
    totalTransactions: MOCK_TRANSACTIONS.length,
    automated: MOCK_TRANSACTIONS.filter((t) => t.ruleId !== null && t.journalId !== null).length,
    imported: imported.length,
    importedMatched: imported.filter((t) => t.allocationStatus === "Matched").length,
    importedRuleApplied: ruleApplied.length,
    importedRuleSucceeded: ruleApplied.filter((t) => t.allocationStatus === "Matched" || t.allocationStatus === "Allocated").length,
    importedWithConfidence: withConfidence.length,
    importedConfidenceSum: withConfidence.reduce((sum, t) => sum + (t.confidenceScore ?? 0), 0),
  };
})();
