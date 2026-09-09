import type { BankStatementEmailStatus, CompanyBankStatementEmailRecord } from "./types";

export type CompanyBankStatementEmailRow = {
  id: number;
  company_id: string;
  stable_identifier: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_received_at: string | null;
  last_successful_import_at: string | null;
  last_failure_at: string | null;
};

export function companyBankStatementEmailFromRow(row: CompanyBankStatementEmailRow): CompanyBankStatementEmailRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    stableIdentifier: row.stable_identifier,
    status: row.status as BankStatementEmailStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReceivedAt: row.last_received_at,
    lastSuccessfulImportAt: row.last_successful_import_at,
    lastFailureAt: row.last_failure_at,
  };
}
