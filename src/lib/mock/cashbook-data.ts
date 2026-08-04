/**
 * Preview Mode seed data for the Cashbook & Bank Reconciliation
 * workspace (Workflow Completion Audit). Manually captured entries reuse
 * the SAME `BankTransactionRecord` shape Import Centre/Transaction
 * Explorer already use — no parallel mock object. The reconciliation
 * summary is DERIVED via the real `buildReconciliationSummary` pure
 * engine against these mock transactions, not hand-typed.
 */

import { buildReconciliationSummary, type ReconciliationSummary } from "@/server/banking/reconciliation-engine";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { BankReconciliation, CashbookBatch } from "@/server/banking/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;
const BANK_ACCOUNT_ID = 1; // "Main Trading Account" — see bank-accounts-data.ts

function baseTransaction(overrides: Partial<BankTransactionRecord>): BankTransactionRecord {
  return {
    id: 0, companyId: COMPANY_ID, transactionDate: null, reference: "", description: "", beneficiary: "",
    debit: 0, credit: 0, balance: null, bankAccount: "Main Trading Account", bankAccountId: BANK_ACCOUNT_ID,
    glAccount: "", vat: 0, notes: "", importBatch: "", sourceFilename: "", createdAt: "2026-07-01T08:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null, suggestedGlAccount: null,
    suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null,
    matchedCustomerId: null, matchedMerchantId: null, ruleId: null,
    entrySource: "Manual", captureStatus: "Draft", cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

export const MOCK_CASHBOOK_BATCHES: CashbookBatch[] = [
  { id: 1, companyId: COMPANY_ID, batchNumber: "CB000001", batchDate: "2026-07-28", batchType: "Mixed", status: "Posted", notes: "Week-ending petty cash and sundry receipts.", createdBy: "System", createdAt: "2026-07-28T08:00:00Z" },
  { id: 2, companyId: COMPANY_ID, batchNumber: "CB000002", batchDate: "2026-07-30", batchType: "Receipts", status: "Draft", notes: "", createdBy: "System", createdAt: "2026-07-30T08:00:00Z" },
];

export const MOCK_CASHBOOK_TRANSACTIONS: BankTransactionRecord[] = [
  // Imported feed — already there, unaffected by this module (entrySource stays "Imported" implicitly via override).
  baseTransaction({ id: 101, entrySource: "Imported", captureStatus: null, transactionDate: "2026-07-05", reference: "STMT-0705", description: "Card Sales Deposit", debit: 0, credit: 8500, journalId: 5001, reconciliationId: 501 }),
  baseTransaction({ id: 102, entrySource: "Imported", captureStatus: null, transactionDate: "2026-07-12", reference: "STMT-0712", description: "Supplier Debit Order — Telkom", debit: 1200, credit: 0, journalId: 5002, reconciliationId: 501 }),
  baseTransaction({ id: 103, entrySource: "Imported", captureStatus: null, transactionDate: "2026-07-29", reference: "STMT-0729", description: "EFT Received — Unallocated", debit: 0, credit: 3400, journalId: null, reconciliationId: null }),

  // Cashbook Capture — Receipts Cashbook / Payments Cashbook.
  baseTransaction({ id: 201, cashbookBatchId: 1, transactionDate: "2026-07-28", reference: "CB-R-001", description: "Cash sale — till reconciliation", glAccount: "4000", debit: 0, credit: 1250, captureStatus: "Posted", journalId: 5010 }),
  baseTransaction({ id: 202, cashbookBatchId: 1, transactionDate: "2026-07-28", reference: "CB-P-001", description: "Petty cash — office supplies", glAccount: "6300", debit: 340, credit: 0, captureStatus: "Posted", journalId: 5011 }),
  baseTransaction({ id: 203, cashbookBatchId: 2, transactionDate: "2026-07-30", reference: "CB-R-002", description: "Interest on call account", glAccount: "6200", debit: 0, credit: 210, captureStatus: "Draft" }),
  baseTransaction({ id: 204, transactionDate: "2026-07-27", reference: "CB-P-002", description: "Bank error correction — reversed", glAccount: "6100", debit: 90, credit: 0, captureStatus: "Cancelled" }),

  // Bank Transfer — two linked legs sharing one reference, both Posted.
  baseTransaction({ id: 301, bankAccountId: 1, bankAccount: "Main Trading Account", transactionDate: "2026-07-15", reference: "TRANSFER-1", description: "Transfer to Payroll Account — monthly funding", beneficiary: "Payroll Account", debit: 15000, credit: 0, captureStatus: "Posted", journalId: 5020 }),
  baseTransaction({ id: 302, bankAccountId: 2, bankAccount: "Payroll Account", transactionDate: "2026-07-15", reference: "TRANSFER-1", description: "Transfer from Main Trading Account — monthly funding", beneficiary: "Main Trading Account", debit: 0, credit: 15000, captureStatus: "Posted", journalId: 5020 }),

  // A reversal — the honest "new offsetting entry" pattern.
  baseTransaction({ id: 401, transactionDate: "2026-07-29", reference: "REV-CB-P-003", description: "Reversal of Cashbook Payment CB-P-003", glAccount: "6300", debit: 0, credit: 500, captureStatus: "Posted", journalId: 5030, reversalOfTransactionId: 205 }),
];

export const MOCK_BANK_RECONCILIATIONS: BankReconciliation[] = [
  {
    id: 501, companyId: COMPANY_ID, bankAccountId: BANK_ACCOUNT_ID, statementDate: "2026-07-15",
    statementClosingBalance: 397650.75, glClosingBalance: 397650.75, difference: 0,
    status: "Completed", monthEndLocked: true, notes: "June month-end — locked.",
    createdBy: "System", createdAt: "2026-07-16T08:00:00Z",
    completedBy: "System", completedAt: "2026-07-16T09:30:00Z",
    reopenedBy: null, reopenedAt: null, reopenReason: "",
  },
  {
    id: 502, companyId: COMPANY_ID, bankAccountId: BANK_ACCOUNT_ID, statementDate: "2026-07-31",
    statementClosingBalance: 412650.75, glClosingBalance: 409250.75, difference: 3400,
    status: "InProgress", monthEndLocked: false, notes: "",
    createdBy: "System", createdAt: "2026-07-31T08:00:00Z",
    completedBy: null, completedAt: null,
    reopenedBy: null, reopenedAt: null, reopenReason: "",
  },
];

export const MOCK_RECONCILIATION_SUMMARY: ReconciliationSummary = buildReconciliationSummary(
  MOCK_CASHBOOK_TRANSACTIONS.filter((t) => t.bankAccountId === BANK_ACCOUNT_ID),
  "2026-07-31",
  412650.75,
  409250.75,
);
