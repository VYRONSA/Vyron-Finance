/**
 * Repository layer for Tax Configuration (VAT treatments). Seed values
 * are inserted via `seed_company_defaults()` at company-creation time
 * (see `company-repository.ts::seedCompanyDefaults`) — this file is the
 * CRUD layer on top of whatever's on file, ported 1:1 in structure from
 * `accounting_engine/vat_codes.py`'s `VAT_CODES`/`VAT_RATES`.
 */

import { createClient } from "@/lib/supabase/server";
import { vatTreatmentFromRow, type VatTreatmentRow } from "@/server/company-management/mappers";
import type { VatTreatment } from "@/server/company-management/types";

export async function listVatTreatments(companyId: string): Promise<VatTreatment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_treatments")
    .select("*")
    .eq("company_id", companyId)
    .order("code")
    .returns<VatTreatmentRow[]>();
  if (error) throw error;
  return data.map(vatTreatmentFromRow);
}

export async function getVatTreatment(companyId: string, vatTreatmentId: number): Promise<VatTreatment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_treatments")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", vatTreatmentId)
    .maybeSingle<VatTreatmentRow>();
  if (error) throw error;
  return data ? vatTreatmentFromRow(data) : null;
}

export type NewVatTreatment = { code: string; name: string; rate: number; vatType?: VatTreatment["vatType"] };

/** Creating a treatment also seeds its first `vat_rate_history` row —
 * every treatment has real, effective-dated history from the moment it
 * exists, never a gap. `vatType` defaults to 'Standard' (matching the
 * column's own DB default) when not supplied. */
export async function createVatTreatment(companyId: string, input: NewVatTreatment): Promise<VatTreatment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_treatments")
    .insert({ company_id: companyId, code: input.code, name: input.name, rate: input.rate, vat_type: input.vatType ?? "Standard" })
    .select("*")
    .single<VatTreatmentRow>();
  if (error) throw error;

  const { error: historyError } = await supabase
    .from("vat_rate_history")
    .insert({ vat_treatment_id: data.id, rate: input.rate, effective_from: new Date().toISOString().slice(0, 10) });
  if (historyError) throw historyError;

  return vatTreatmentFromRow(data);
}

export type UpdatableVatTreatmentFields = Partial<{ name: string; vat_type: string; is_active: boolean }>;

/** Deliberately does NOT accept `rate` — changing a treatment's rate
 * goes through `vat-rate-history-repository.ts::changeRate` instead, so
 * a rate change always leaves a real effective-dated history row rather
 * than silently overwriting the number every past calculation used. */
export async function updateVatTreatment(companyId: string, vatTreatmentId: number, fields: UpdatableVatTreatmentFields): Promise<VatTreatment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_treatments")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", vatTreatmentId)
    .select("*")
    .single<VatTreatmentRow>();
  if (error) throw error;
  return vatTreatmentFromRow(data);
}
