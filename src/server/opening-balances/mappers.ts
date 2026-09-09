import type { OpeningBalanceCategory, OpeningBalanceEntry, OpeningBalanceStatus } from "./types";

export type OpeningBalanceEntryRow = {
  id: number;
  company_id: string;
  category: string;
  account_code: string | null;
  bank_account_id: number | null;
  customer_id: number | null;
  supplier_id: number | null;
  description: string;
  amount: number;
  reference: string;
  balance_date: string;
  status: string;
  journal_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function openingBalanceEntryFromRow(row: OpeningBalanceEntryRow): OpeningBalanceEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    category: row.category as OpeningBalanceCategory,
    accountCode: row.account_code,
    bankAccountId: row.bank_account_id,
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    description: row.description,
    amount: Number(row.amount),
    reference: row.reference,
    balanceDate: row.balance_date,
    status: row.status as OpeningBalanceStatus,
    journalId: row.journal_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
