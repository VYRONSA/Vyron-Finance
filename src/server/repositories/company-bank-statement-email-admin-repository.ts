/**
 * Phase 21C — admin-client counterpart to
 * `company-bank-statement-email-repository.ts` (Phase 21B), used ONLY
 * by the inbound webhook path, which has no user session. Reuses the
 * same table (`company_bank_statement_email`) and the same domain
 * mapper — this is a different AUTHORITY (service-role vs. session-
 * scoped), never a different schema or a second source of truth.
 *
 * Two operations only, both genuinely required by the webhook:
 * (1) resolve a recipient's stable identifier to its owning company —
 * this is the entire tenant boundary, and by definition happens before
 * any session-like context exists; (2) record the real, honest
 * operational timestamps (`last_received_at`/`last_successful_import_at`/
 * `last_failure_at`) the Settings UI already knows how to display
 * (Phase 21B) — never fabricated, only ever written here, right when
 * each event genuinely occurs.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { companyBankStatementEmailFromRow, type CompanyBankStatementEmailRow } from "@/server/company-bank-statement-email/mappers";
import type { CompanyBankStatementEmailRecord } from "@/server/company-bank-statement-email/types";

/** Resolves an inbound recipient's stable identifier to the company
 * that owns it — `null` for any identifier that doesn't exist OR whose
 * identity has been disabled. The caller never learns the difference
 * between "unknown" and "disabled" from this function's return value
 * alone (both simply resolve to "no company") — exactly the same
 * "never leak which case it was" discipline `getCompany()` already uses
 * for company lookups elsewhere in this codebase. */
export async function findActiveCompanyBankStatementEmailByIdentifier(stableIdentifier: string): Promise<CompanyBankStatementEmailRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_bank_statement_email")
    .select("*")
    .eq("stable_identifier", stableIdentifier)
    .eq("status", "active")
    .maybeSingle<CompanyBankStatementEmailRow>();
  if (error) throw error;
  return data ? companyBankStatementEmailFromRow(data) : null;
}

export async function recordBankStatementEmailReceived(companyId: string, receivedAtIso: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("company_bank_statement_email")
    .update({ last_received_at: receivedAtIso, updated_at: receivedAtIso })
    .eq("company_id", companyId);
  if (error) throw error;
}

export async function recordBankStatementEmailImportSucceeded(companyId: string, atIso: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("company_bank_statement_email")
    .update({ last_successful_import_at: atIso, updated_at: atIso })
    .eq("company_id", companyId);
  if (error) throw error;
}

export async function recordBankStatementEmailImportFailed(companyId: string, atIso: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("company_bank_statement_email")
    .update({ last_failure_at: atIso, updated_at: atIso })
    .eq("company_id", companyId);
  if (error) throw error;
}
