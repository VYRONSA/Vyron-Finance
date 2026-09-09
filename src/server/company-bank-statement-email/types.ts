/**
 * Domain types for Phase 21B — Bank Statement Email identity
 * foundation. See supabase/migrations/0078_company_bank_statement_email.sql.
 * Identity/storage only — no inbound receiving/processing exists yet.
 */

export type BankStatementEmailStatus = "active" | "disabled";

export type CompanyBankStatementEmailRecord = {
  id: number;
  companyId: string;
  stableIdentifier: string;
  status: BankStatementEmailStatus;
  createdAt: string;
  updatedAt: string;
  lastReceivedAt: string | null;
  lastSuccessfulImportAt: string | null;
  lastFailureAt: string | null;
};

/** What the service actually returns to callers — the stored record
 * plus the constructed display address. `emailAddress` is `null` only
 * when `VYRON_BANK_IMPORT_EMAIL_DOMAIN` isn't configured in this
 * environment — never a fabricated placeholder. */
export type CompanyBankStatementEmail = CompanyBankStatementEmailRecord & {
  emailAddress: string | null;
};
