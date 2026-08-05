/**
 * Application Service layer for Company Setup — validation and the
 * organisation-bootstrap orchestration on top of the repository, never
 * talking to Supabase directly.
 */

import * as repo from "@/server/repositories/company-repository";
import * as permissionRepo from "@/server/repositories/permission-repository";
import * as communicationRepo from "@/server/repositories/communication-repository";
import { getCurrentUserEmail } from "@/server/auth/require-session";
import { subscribeCompanyToPlan } from "@/server/billing-platform/engine/billing-engine";
import type { Company } from "@/server/company-management/types";

export class ValidationError extends Error {}

export type CreateCompanyRequest = {
  name: string;
  industry?: string;
  registrationNumber?: string;
  address?: string;
  financialYearStartMonth?: number;
  baseCurrencyCode?: string;
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

  const company = await repo.createCompany(organisationId, {
    name: input.name.trim(),
    industry: input.industry?.trim(),
    registrationNumber: input.registrationNumber?.trim(),
    address: input.address?.trim(),
    financialYearStartMonth: input.financialYearStartMonth,
    baseCurrencyCode: input.baseCurrencyCode?.trim(),
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
}>;

export async function updateCompany(companyId: string, input: EditCompanyRequest): Promise<Company> {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Company name cannot be empty.");
  if (input.financialYearStartMonth !== undefined && (input.financialYearStartMonth < 1 || input.financialYearStartMonth > 12)) {
    throw new ValidationError("Financial year start month must be between 1 and 12.");
  }

  return repo.updateCompany(companyId, {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.industry !== undefined && { industry: input.industry.trim() }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.registrationNumber !== undefined && { registration_number: input.registrationNumber.trim() }),
    ...(input.address !== undefined && { address: input.address.trim() }),
    ...(input.financialYearStartMonth !== undefined && { financial_year_start_month: input.financialYearStartMonth }),
    ...(input.baseCurrencyCode !== undefined && { base_currency_code: input.baseCurrencyCode.trim() }),
  });
}
