/**
 * Application Service layer for Company Setup — validation and the
 * organisation-bootstrap orchestration on top of the repository, never
 * talking to Supabase directly.
 */

import * as repo from "@/server/repositories/company-repository";
import * as permissionRepo from "@/server/repositories/permission-repository";
import * as communicationRepo from "@/server/repositories/communication-repository";
import { hasAnyPostedJournal } from "@/server/repositories/journal-repository";
import { getCurrentUserEmail } from "@/server/auth/require-session";
import { subscribeCompanyToPlan } from "@/server/billing-platform/engine/billing-engine";
import { createFinancialYear, setCurrentFinancialYear, suggestFinancialYear } from "@/server/services/financial-year-service";
import type { Company } from "@/server/company-management/types";

export class ValidationError extends Error {}

// Phase 20D — sensible format checks only, not SARS/VAT compliance
// validation (no such service exists in this codebase, and none is
// invented here — see the Phase 20D-A inspection report). Both are
// intentionally permissive: this codebase stores company information,
// it does not adjudicate what a "real" business email or website looks
// like.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

function isValidWebsite(value: string): boolean {
  try {
    new URL(value.includes("://") ? value : `https://${value}`);
    return true;
  } catch {
    return false;
  }
}

/** Finding #136/#137 — a real, disclosed business decision made in the
 * absence of a stated directive value, same convention as
 * `billing-engine.ts::TRIAL_LENGTH_DAYS` — flagged for confirmation,
 * not silently assumed correct forever. Free-trial organisations were
 * previously able to create an unbounded number of companies. */
export const FREE_TRIAL_MAX_COMPANIES = 5;

export type CreateCompanyRequest = {
  name: string;
  industry?: string;
  registrationNumber?: string;
  address?: string;
  financialYearStartMonth?: number;
  baseCurrencyCode?: string;
  // Phase 20D — the Company Creation Wizard already collects these two;
  // this is what actually persists them now. Every OTHER wizard-only
  // field (VAT registered/frequency, tax system, CoA template, etc.)
  // remains deliberately unsupported here — see the wizard's own
  // `WizardValues` doc comment.
  tradingName?: string;
  vatNumber?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};

export function validateCreateCompanyInput(input: CreateCompanyRequest) {
  if (!input.name?.trim()) throw new ValidationError("Company name is required.");
  if (input.financialYearStartMonth !== undefined && (input.financialYearStartMonth < 1 || input.financialYearStartMonth > 12)) {
    throw new ValidationError("Financial year start month must be between 1 and 12.");
  }
}

/** Resolves which organisation a new company should belong to: the
 * user's best-role existing membership, or a freshly bootstrapped
 * organisation (named after the company, editable later) if they have
 * none yet. Exported standalone so the decision logic itself — given an
 * existing-membership id or `null` — is unit-testable without Supabase. */
export function resolveOrganisationBootstrap(existingOrganisationId: string | null, companyName: string): { needsBootstrap: boolean; organisationName?: string } {
  if (existingOrganisationId) return { needsBootstrap: false };
  return { needsBootstrap: true, organisationName: `${companyName.trim()} Organisation` };
}

export async function createCompany(userId: string, input: CreateCompanyRequest): Promise<Company> {
  validateCreateCompanyInput(input);

  const existingOrganisationId = await repo.findBestOrganisationForUser(userId);
  const bootstrap = resolveOrganisationBootstrap(existingOrganisationId, input.name);
  const organisationId = bootstrap.needsBootstrap
    ? await repo.bootstrapOrganisation(userId, bootstrap.organisationName!)
    : existingOrganisationId!;

  if (!bootstrap.needsBootstrap) {
    const existingCompanyCount = await repo.countCompaniesForOrganisation(organisationId);
    if (existingCompanyCount >= FREE_TRIAL_MAX_COMPANIES) {
      throw new ValidationError(
        `Your organisation already has ${existingCompanyCount} companies, the maximum for a free-trial organisation. Contact support to raise this limit.`,
      );
    }
  }

  const company = await repo.createCompany(organisationId, {
    name: input.name.trim(),
    industry: input.industry?.trim(),
    registrationNumber: input.registrationNumber?.trim(),
    address: input.address?.trim(),
    financialYearStartMonth: input.financialYearStartMonth,
    baseCurrencyCode: input.baseCurrencyCode?.trim(),
    tradingName: input.tradingName?.trim(),
    vatNumber: input.vatNumber?.trim(),
    city: input.city?.trim(),
    province: input.province?.trim(),
    postalCode: input.postalCode?.trim(),
    country: input.country?.trim(),
  });

  // RC1 Phase 1 — every new company gets its 15 real system roles
  // immediately (idempotent RPC — see 0025_rbac_platform.sql), and the
  // creating user is assigned the Company Owner role so the company is
  // never left in an "everyone unassigned, nobody can approve anything"
  // state on day one.
  //
  // Pilot Review Round 1 Final Certification — found live (via migration
  // 0056's own comment for the full trace): a plain client-side read of
  // `permission_roles` to find the `company_owner` role id, followed by
  // `assign_company_role`, both independently required the caller to
  // already have access to/permission on a company that — by
  // definition, at this exact moment — has no role assignments yet.
  // Masked in every prior round of live verification because the test
  // admin accounts used already held a platform-scope role. Fixed with
  // one atomic, security-definer bootstrap RPC (mirrors
  // `bootstrap_organisation`'s own trust model) that needs no
  // client-side role lookup and self-limits to a company's first-ever
  // role assignment. This block must still run before `seedCompanyDefaults`
  // below — `seed_company_defaults()` (0006) is `security invoker` and
  // needs the creating user's role assignment to already exist.
  await permissionRepo.seedCompanyRbacDefaults(company.id);
  await permissionRepo.bootstrapCompanyOwnerRole(company.id, "System");
  await permissionRepo.grantManageBillingToCompanyOwner(company.id);

  // Pilot Review Round 1 — deliberately non-blocking. This grant's RPC
  // (migration 0055) is not guaranteed to exist in every environment the
  // moment this code ships (the same real gap D-032 already documented:
  // a new permission-grant step failing must never break the whole
  // Company Creation flow). A company created before the migration is
  // applied simply doesn't have this grant yet — exactly the same
  // "backfill later" shape as D-018/D-028's own fix (migration 0054).
  try {
    await permissionRepo.grantManageOpeningBalancesDefaults(company.id);
  } catch (error) {
    console.error("grantManageOpeningBalancesDefaults failed (non-fatal — company creation continues):", error);
  }

  await repo.seedCompanyDefaults(company.id);
  await communicationRepo.seedCompanyCommunicationDefaults(company.id);

  // Finding #203 — same non-blocking "may not exist in every environment
  // yet" reasoning as `grantManageOpeningBalancesDefaults` above.
  try {
    await repo.seedVatPaymentPostingRule(company.id);
  } catch (error) {
    console.error("seedVatPaymentPostingRule failed (non-fatal — company creation continues):", error);
  }

  // Phase 26F — same non-blocking "may not exist in every environment
  // yet" reasoning as the two seeds immediately above. Widens the new
  // company's chart with a real operating-expense/asset/liability/equity
  // set (migration 0086) so AI classification has enough candidate
  // accounts from day one — never overwrites/replaces `seedCompanyDefaults`'s
  // own 26 accounts, only adds new ones.
  try {
    await repo.seedExpandedOperatingExpenseChart(company.id);
  } catch (error) {
    console.error("seedExpandedOperatingExpenseChart failed (non-fatal — company creation continues):", error);
  }

  // Pilot Review Round 1 Final Certification — found live: a brand new
  // company had zero rows in `financial_years` (that table has always
  // been purely manual — no reference-app or prior-phase seeding ever
  // populated it), so `validatePostingDate` correctly refused every
  // Cashbook/Journal posting with "No financial year covers <date>."
  // immediately after signup — even though creating a company implies
  // its onboarding will start soon and needs to be able to post
  // straight away. Opening Balances posting never hit this because
  // `postApprovedJournals` itself doesn't call `validatePostingDate` —
  // an existing, disclosed inconsistency between modules, not something
  // this fix changes. Seeds exactly the one financial year that covers
  // today, using the company's own `financial_year_start_month` and the
  // same period-math (`suggestFinancialYear`) the manual "create
  // financial year" form already uses — no new date logic invented.
  const currentFinancialYear = suggestFinancialYear(new Date().toISOString().slice(0, 10), company.financialYearStartMonth);
  const createdFinancialYear = await createFinancialYear(company.id, currentFinancialYear);
  await setCurrentFinancialYear(company.id, createdFinancialYear.id);

  // Commercial Billing Platform — "a customer must never create a
  // production company without passing through the Billing Platform
  // first." Every new company starts a real free trial immediately;
  // there is no company creation path that skips it.
  const billingEmail = await getCurrentUserEmail();
  await subscribeCompanyToPlan({
    companyId: company.id,
    organisationId,
    planKey: "free_trial",
    billingCycle: "monthly",
    billingEmail: billingEmail ?? "",
    currencyCode: company.baseCurrencyCode,
    performedBy: billingEmail ?? "System",
    nowIso: new Date().toISOString(),
  });

  return company;
}

export function listCompaniesForUser(userId: string): Promise<Company[]> {
  return repo.listCompaniesForUser(userId);
}

export function getCompany(companyId: string): Promise<Company | null> {
  return repo.getCompany(companyId);
}

export type EditCompanyRequest = Partial<{
  name: string;
  industry: string;
  status: Company["status"];
  registrationNumber: string;
  address: string;
  financialYearStartMonth: number;
  baseCurrencyCode: string;
  tradingName: string;
  vatNumber: string;
  telephone: string;
  email: string;
  website: string;
  postalAddress: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}>;

export async function updateCompany(companyId: string, input: EditCompanyRequest): Promise<Company> {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Company name cannot be empty.");
  if (input.financialYearStartMonth !== undefined && (input.financialYearStartMonth < 1 || input.financialYearStartMonth > 12)) {
    throw new ValidationError("Financial year start month must be between 1 and 12.");
  }
  // Phase 20D — both fields are optional; an empty string means "not
  // provided" and is always valid. Only a non-empty, malformed value is
  // rejected.
  if (input.email !== undefined && input.email.trim() !== "" && !isValidEmail(input.email.trim())) {
    throw new ValidationError("Email is not a valid email address.");
  }
  if (input.website !== undefined && input.website.trim() !== "" && !isValidWebsite(input.website.trim())) {
    throw new ValidationError("Website is not a valid website address.");
  }

  // Finding #060 — changing the base currency or financial year start
  // month once real journals are posted would silently misdate/
  // misdenominate every prior period comparison and currency report.
  // Only checked when one of these two fields is actually changing
  // (not merely present in the request, unmodified).
  if (input.baseCurrencyCode !== undefined || input.financialYearStartMonth !== undefined) {
    const existing = await repo.getCompany(companyId);
    const currencyChanging = existing && input.baseCurrencyCode !== undefined && input.baseCurrencyCode.trim() !== existing.baseCurrencyCode;
    const fyStartChanging = existing && input.financialYearStartMonth !== undefined && input.financialYearStartMonth !== existing.financialYearStartMonth;
    if ((currencyChanging || fyStartChanging) && (await hasAnyPostedJournal(companyId))) {
      throw new ValidationError(
        "Base currency and financial year start month cannot be changed once this company has posted journals — they would misdate or misdenominate existing history.",
      );
    }
  }

  return repo.updateCompany(companyId, {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.industry !== undefined && { industry: input.industry.trim() }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.registrationNumber !== undefined && { registration_number: input.registrationNumber.trim() }),
    ...(input.address !== undefined && { address: input.address.trim() }),
    ...(input.financialYearStartMonth !== undefined && { financial_year_start_month: input.financialYearStartMonth }),
    ...(input.baseCurrencyCode !== undefined && { base_currency_code: input.baseCurrencyCode.trim() }),
    ...(input.tradingName !== undefined && { trading_name: input.tradingName.trim() }),
    ...(input.vatNumber !== undefined && { vat_number: input.vatNumber.trim() }),
    ...(input.telephone !== undefined && { telephone: input.telephone.trim() }),
    ...(input.email !== undefined && { email: input.email.trim() }),
    ...(input.website !== undefined && { website: input.website.trim() }),
    ...(input.postalAddress !== undefined && { postal_address: input.postalAddress.trim() }),
    ...(input.city !== undefined && { city: input.city.trim() }),
    ...(input.province !== undefined && { province: input.province.trim() }),
    ...(input.postalCode !== undefined && { postal_code: input.postalCode.trim() }),
    ...(input.country !== undefined && { country: input.country.trim() }),
  });
}
