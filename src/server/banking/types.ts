/**
 * Domain types for the Cashbook & Bank Reconciliation workspace
 * (Workflow Completion Audit). See
 * supabase/migrations/0022_cashbook_reconciliation.sql. Manually
 * captured cash entries themselves reuse `BankTransactionRecord`
 * (`src/server/accounting/types.ts`) directly — no parallel object.
 */

export type CashbookBatchType = "Receipts" | "Payments" | "Transfers" | "Mixed";
export const CASHBOOK_BATCH_TYPES: CashbookBatchType[] = ["Receipts", "Payments", "Transfers", "Mixed"];

export type CashbookBatchStatus = "Draft" | "Approved" | "Posted";

export type CashbookBatch = {
  id: number;
  companyId: string;
  batchNumber: string;
  batchDate: string;
  batchType: CashbookBatchType;
  status: CashbookBatchStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
};

export type BankReconciliationStatus = "InProgress" | "Completed" | "Reopened";

export type BankReconciliation = {
  id: number;
  companyId: string;
  bankAccountId: number;
  statementDate: string;
  statementClosingBalance: number;
  glClosingBalance: number | null;
  difference: number | null;
  status: BankReconciliationStatus;
  monthEndLocked: boolean;
  notes: string;
  createdBy: string;
  createdAt: string;
  completedBy: string | null;
  completedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string;
};
