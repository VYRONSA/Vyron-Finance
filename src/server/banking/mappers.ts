/**
 * Row <-> domain type mappers for Cashbook Batches and Bank
 * Reconciliations. See
 * supabase/migrations/0022_cashbook_reconciliation.sql.
 */

import type { BankReconciliation, CashbookBatch } from "./types";

export type CashbookBatchRow = {
  id: number;
  company_id: string;
  batch_number: string;
  batch_date: string;
  batch_type: string;
  status: string;
  notes: string;
  created_by: string;
  created_at: string;
};

export function cashbookBatchFromRow(row: CashbookBatchRow): CashbookBatch {
  return {
    id: row.id,
    companyId: row.company_id,
    batchNumber: row.batch_number,
    batchDate: row.batch_date,
    batchType: row.batch_type as CashbookBatch["batchType"],
    status: row.status as CashbookBatch["status"],
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export type BankReconciliationRow = {
  id: number;
  company_id: string;
  bank_account_id: number;
  statement_date: string;
  statement_closing_balance: number;
  gl_closing_balance: number | null;
  difference: number | null;
  status: string;
  month_end_locked: boolean;
  notes: string;
  created_by: string;
  created_at: string;
  completed_by: string | null;
  completed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string;
};

export function bankReconciliationFromRow(row: BankReconciliationRow): BankReconciliation {
  return {
    id: row.id,
    companyId: row.company_id,
    bankAccountId: row.bank_account_id,
    statementDate: row.statement_date,
    statementClosingBalance: Number(row.statement_closing_balance),
    glClosingBalance: row.gl_closing_balance !== null ? Number(row.gl_closing_balance) : null,
    difference: row.difference !== null ? Number(row.difference) : null,
    status: row.status as BankReconciliation["status"],
    monthEndLocked: row.month_end_locked,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    reopenedBy: row.reopened_by,
    reopenedAt: row.reopened_at,
    reopenReason: row.reopen_reason,
  };
}
