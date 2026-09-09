/**
 * Application Service for Phase 21B — Bank Statement Email identity
 * foundation. The ONE place any caller reads or lazily creates a
 * company's stable inbound-email identity. Identity/storage only — this
 * file does not itself receive, parse, or import anything; that
 * pipeline is built (Phase 21C/21F, `inbound-bank-statement-email-
 * service.ts`) and reads the identity this file manages, but genuine
 * end-to-end delivery still depends on this environment's inbound
 * email routing (Resend/Virtualmin) being configured to reach it — see
 * that file's own docstring for the current deployment status.
 *
 * Permission model: reading follows the same "session + RLS company
 * access" pattern as every other read in this codebase (see the
 * migration's own SELECT policy) — no extra permission check here, by
 * design. A future explicit mutation (e.g. regenerating the identifier)
 * would be gated by `requirePermission(companyId, "Settings:Edit")` at
 * the API route layer, the same permission that already protects every
 * other Company Settings write — but no such mutation exists yet in
 * this phase, so nothing here calls it.
 */

import * as repo from "@/server/repositories/company-bank-statement-email-repository";
import { getCompany } from "@/server/services/company-service";
import { generateStableIdentifierCandidate, buildBankStatementEmailAddress } from "@/server/company-bank-statement-email/identifier-engine";
import type { CompanyBankStatementEmail, CompanyBankStatementEmailRecord } from "@/server/company-bank-statement-email/types";

export class NotFoundError extends Error {}

const MAX_GENERATION_ATTEMPTS = 5;

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  return code === "23505" && message.includes(constraintName);
}

function toResult(record: CompanyBankStatementEmailRecord): CompanyBankStatementEmail {
  let emailAddress: string | null;
  try {
    emailAddress = buildBankStatementEmailAddress(record.stableIdentifier);
  } catch {
    emailAddress = null;
  }
  return { ...record, emailAddress };
}

/** Returns the company's existing identity, or `null` if one hasn't
 * been created yet — never creates one. Use `ensureCompanyBankStatementEmail`
 * when the caller wants one to exist. */
export async function getCompanyBankStatementEmail(companyId: string): Promise<CompanyBankStatementEmail | null> {
  const record = await repo.getCompanyBankStatementEmail(companyId);
  return record ? toResult(record) : null;
}

/** Returns the company's identity, lazily creating it on first call.
 * Idempotent and safe under concurrent calls — the database's own
 * `unique (company_id)` constraint is the real guarantee, not
 * application-level locking: if two requests race, the loser's insert
 * fails with a unique violation, and it simply re-fetches and returns
 * the winner's row rather than erroring. A separate, astronomically
 * rare stable-identifier collision (two different companies' random
 * candidates landing on the exact same value) is handled by generating
 * a fresh candidate and retrying, up to a small bounded number of
 * attempts, so a persistent RNG/DB fault fails loudly rather than
 * looping forever. */
export async function ensureCompanyBankStatementEmail(companyId: string): Promise<CompanyBankStatementEmail> {
  const existing = await repo.getCompanyBankStatementEmail(companyId);
  if (existing) return toResult(existing);

  const company = await getCompany(companyId);
  if (!company) throw new NotFoundError(`No company with id ${companyId}.`);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateStableIdentifierCandidate(company.name);
    try {
      const created = await repo.insertCompanyBankStatementEmail(companyId, candidate);
      return toResult(created);
    } catch (error) {
      if (isUniqueViolation(error, "company_bank_statement_email_company_id_key")) {
        const raceWinner = await repo.getCompanyBankStatementEmail(companyId);
        if (raceWinner) return toResult(raceWinner);
      }
      if (isUniqueViolation(error, "company_bank_statement_email_stable_identifier_key")) {
        continue; // a genuinely rare cross-company collision — try a fresh candidate
      }
      throw error;
    }
  }

  throw new Error(`Could not generate a unique bank statement email identifier for company ${companyId} after ${MAX_GENERATION_ATTEMPTS} attempts.`);
}
