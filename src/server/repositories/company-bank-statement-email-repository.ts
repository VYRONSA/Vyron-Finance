/**
 * Repository layer for Phase 21B — Bank Statement Email identity
 * foundation. See supabase/migrations/0078_company_bank_statement_email.sql.
 * Identity/storage only — no inbound receiving/processing exists yet.
 */

import { createClient } from "@/lib/supabase/server";
import { companyBankStatementEmailFromRow, type CompanyBankStatementEmailRow } from "@/server/company-bank-statement-email/mappers";
import type { CompanyBankStatementEmailRecord } from "@/server/company-bank-statement-email/types";

export async function getCompanyBankStatementEmail(companyId: string): Promise<CompanyBankStatementEmailRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_bank_statement_email")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle<CompanyBankStatementEmailRow>();
  if (error) throw error;
  return data ? companyBankStatementEmailFromRow(data) : null;
}

/** Creates the company's one bank-statement-email identity row.
 * `company_id` and `stable_identifier` are both real, named unique
 * constraints — the caller (the service layer) is responsible for
 * catching a unique-violation and deciding whether that means "another
 * request already created this company's row" (re-fetch and use it) or
 * "the random identifier collided with a different company's" (generate
 * a fresh candidate and retry). This function never retries itself —
 * one insert attempt, one real outcome. */
export async function insertCompanyBankStatementEmail(companyId: string, stableIdentifier: string): Promise<CompanyBankStatementEmailRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_bank_statement_email")
    .insert({ company_id: companyId, stable_identifier: stableIdentifier })
    .select("*")
    .single<CompanyBankStatementEmailRow>();
  if (error) throw error;
  return companyBankStatementEmailFromRow(data);
}
