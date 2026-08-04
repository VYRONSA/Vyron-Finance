/**
 * Repository layer for Currencies — `currencies` is global reference
 * data (no `company_id`, no RLS company check, see
 * supabase/migrations/0006_company_management.sql); `company_currencies`
 * is the per-company "which foreign currencies do we deal in" setting.
 */

import { createClient } from "@/lib/supabase/server";
import { companyCurrencyFromRow, currencyFromRow, type CompanyCurrencyRow, type CurrencyRow } from "@/server/company-management/mappers";
import type { CompanyCurrency, Currency } from "@/server/company-management/types";

export async function listCurrencies(): Promise<Currency[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("currencies").select("*").order("code").returns<CurrencyRow[]>();
  if (error) throw error;
  return data.map(currencyFromRow);
}

export async function listCompanyCurrencies(companyId: string): Promise<CompanyCurrency[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_currencies")
    .select("*")
    .eq("company_id", companyId)
    .returns<CompanyCurrencyRow[]>();
  if (error) throw error;
  return data.map(companyCurrencyFromRow);
}

/** Enable/disable a currency for a company — upsert so toggling a
 * currency on and off repeatedly never creates duplicate rows (the
 * migration's `unique (company_id, currency_code)` is the backstop). */
export async function setCompanyCurrencyEnabled(companyId: string, currencyCode: string, isActive: boolean): Promise<CompanyCurrency> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_currencies")
    .upsert({ company_id: companyId, currency_code: currencyCode, is_active: isActive }, { onConflict: "company_id,currency_code" })
    .select("*")
    .single<CompanyCurrencyRow>();
  if (error) throw error;
  return companyCurrencyFromRow(data);
}
