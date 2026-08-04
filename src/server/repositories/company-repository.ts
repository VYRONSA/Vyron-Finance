/**
 * Repository layer for Company Setup — the only layer allowed to speak
 * Supabase for companies/organisations. RLS (see
 * supabase/migrations/0001_platform_foundation.sql,
 * 0006_company_management.sql) is the real authorization boundary;
 * queries here still filter explicitly so intent is never left to RLS
 * alone.
 */

import { createClient } from "@/lib/supabase/server";
import { companyFromRow, type CompanyRow } from "@/server/company-management/mappers";
import type { Company, CompanyStatus } from "@/server/company-management/types";

const ROLE_PRIORITY: Record<string, number> = { owner: 0, admin: 1, member: 2 };

/** The organisation this user should create a new company under: their
 * best-role (owner > admin > member) existing membership, or `null` if
 * they have none yet — in which case the service bootstraps one. */
export async function findBestOrganisationForUser(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organisation_members").select("organisation_id, role").eq("user_id", userId);
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const best = [...data].sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99))[0];
  return best.organisation_id;
}

/** Creates a brand-new organisation and makes the calling user its
 * owner, via the `bootstrap_organisation` RPC (migration
 * 0033_organisation_bootstrap_fix.sql). NOT two separate client-side
 * inserts (organisation, then membership) — RLS's SELECT policy on
 * `organisations` requires membership to even see a row via
 * `.select()`'s implicit RETURNING, which the caller doesn't have yet
 * at the moment of the first insert. That two-step version passed
 * every unit test (mocked, RLS never runs) and every Preview Mode
 * check (no real database), and only failed the first time it ever ran
 * against a real Postgres database with RLS enabled — found during RC1
 * Phase 7.6 live certification. The RPC does both inserts in one
 * transaction, using `auth.uid()` directly rather than a
 * caller-supplied id, so the parameter here is unused but kept for the
 * call site's own clarity about whose organisation this is. */
export async function bootstrapOrganisation(_userId: string, name: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bootstrap_organisation", { org_name: name });
  if (error) throw error;
  return data as string;
}

export async function listCompaniesForUser(userId: string): Promise<Company[]> {
  const supabase = await createClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId);
  if (membershipError) throw membershipError;

  const organisationIds = (memberships ?? []).map((m) => m.organisation_id);
  if (organisationIds.length === 0) return [];

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .in("organisation_id", organisationIds)
    .order("name")
    .returns<CompanyRow[]>();
  if (error) throw error;
  return data.map(companyFromRow);
}

export async function getCompany(companyId: string): Promise<Company | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle<CompanyRow>();
  if (error) throw error;
  return data ? companyFromRow(data) : null;
}

export type NewCompany = {
  name: string;
  industry?: string;
  registrationNumber?: string;
  address?: string;
  financialYearStartMonth?: number;
  baseCurrencyCode?: string;
};

export async function createCompany(organisationId: string, input: NewCompany): Promise<Company> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      organisation_id: organisationId,
      name: input.name,
      industry: input.industry ?? "",
      registration_number: input.registrationNumber ?? "",
      address: input.address ?? "",
      financial_year_start_month: input.financialYearStartMonth ?? 3,
      base_currency_code: input.baseCurrencyCode ?? "ZAR",
    })
    .select("*")
    .single<CompanyRow>();
  if (error) throw error;
  return companyFromRow(data);
}

/** Ported behaviour from `CompanyService.create()` seeding a default
 * Chart of Accounts — this port has no Chart of Accounts table yet
 * (Module 10, General Ledger), so only the VAT treatments this module
 * owns are seeded; see `seed_company_defaults()` in the migration. */
export async function seedCompanyDefaults(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("seed_company_defaults", { p_company_id: companyId });
  if (error) throw error;
}

export type UpdatableCompanyFields = Partial<{
  name: string;
  industry: string;
  status: CompanyStatus;
  registration_number: string;
  address: string;
  financial_year_start_month: number;
  base_currency_code: string;
}>;

export async function updateCompany(companyId: string, fields: UpdatableCompanyFields): Promise<Company> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("companies").update(fields).eq("id", companyId).select("*").single<CompanyRow>();
  if (error) throw error;
  return companyFromRow(data);
}
