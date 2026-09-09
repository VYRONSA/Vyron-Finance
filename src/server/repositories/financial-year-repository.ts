/**
 * Repository layer for Financial Years — the only layer allowed to speak
 * Supabase for this sub-area of Company Management.
 */

import { createClient } from "@/lib/supabase/server";
import { financialYearFromRow, type FinancialYearRow } from "@/server/company-management/mappers";
import type { FinancialYear } from "@/server/company-management/types";

export async function listFinancialYears(companyId: string): Promise<FinancialYear[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_years")
    .select("*")
    .eq("company_id", companyId)
    .order("start_date", { ascending: false })
    .returns<FinancialYearRow[]>();
  if (error) throw error;
  return data.map(financialYearFromRow);
}

export type NewFinancialYear = { yearLabel: string; startDate: string; endDate: string };

export async function createFinancialYear(companyId: string, input: NewFinancialYear): Promise<FinancialYear> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_years")
    .insert({ company_id: companyId, year_label: input.yearLabel, start_date: input.startDate, end_date: input.endDate })
    .select("*")
    .single<FinancialYearRow>();
  if (error) throw error;
  return financialYearFromRow(data);
}

/** Clears whichever row is currently `is_current` before setting the new
 * one — two sequential updates (not a single statement) so the DB's
 * "at most one current per company" partial unique index is never
 * violated mid-operation. */
export async function setCurrentFinancialYear(companyId: string, financialYearId: number): Promise<FinancialYear> {
  const supabase = await createClient();
  const { error: clearError } = await supabase
    .from("financial_years")
    .update({ is_current: false })
    .eq("company_id", companyId)
    .eq("is_current", true);
  if (clearError) throw clearError;

  const { data, error } = await supabase
    .from("financial_years")
    .update({ is_current: true })
    .eq("company_id", companyId)
    .eq("id", financialYearId)
    .select("*")
    .single<FinancialYearRow>();
  if (error) throw error;
  return financialYearFromRow(data);
}

export async function closeFinancialYear(companyId: string, financialYearId: number): Promise<FinancialYear> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_years")
    .update({ status: "Closed" })
    .eq("company_id", companyId)
    .eq("id", financialYearId)
    .select("*")
    .single<FinancialYearRow>();
  if (error) throw error;
  return financialYearFromRow(data);
}

/** Financial Period locking (Module 10) — `lockDate: null` clears the
 * lock. No reference-app equivalent; see financial-period-service.ts. */
export async function setFinancialYearLockDate(companyId: string, financialYearId: number, lockDate: string | null): Promise<FinancialYear> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_years")
    .update({ lock_date: lockDate })
    .eq("company_id", companyId)
    .eq("id", financialYearId)
    .select("*")
    .single<FinancialYearRow>();
  if (error) throw error;
  return financialYearFromRow(data);
}

export async function reopenFinancialYear(companyId: string, financialYearId: number, performedBy: string): Promise<FinancialYear> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_years")
    .update({ status: "Open", reopened_at: new Date().toISOString(), reopened_by: performedBy })
    .eq("company_id", companyId)
    .eq("id", financialYearId)
    .select("*")
    .single<FinancialYearRow>();
  if (error) throw error;
  return financialYearFromRow(data);
}
