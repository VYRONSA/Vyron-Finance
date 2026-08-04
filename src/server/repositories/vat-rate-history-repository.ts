/**
 * Repository layer for effective-dated VAT rate history — "Do not
 * hardcode tax rates" / "Future tax-rate changes / Effective dates."
 */

import { createClient } from "@/lib/supabase/server";
import { vatRateHistoryFromRow, type VatRateHistoryRow } from "@/server/vat/mappers";
import type { VatRateHistoryEntry } from "@/server/vat/types";

export async function listRateHistory(vatTreatmentId: number): Promise<VatRateHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_rate_history")
    .select("*")
    .eq("vat_treatment_id", vatTreatmentId)
    .order("effective_from", { ascending: false })
    .returns<VatRateHistoryRow[]>();
  if (error) throw error;
  return data.map(vatRateHistoryFromRow);
}

/** Every treatment a company has, with its full rate history — one
 * query per company (not per treatment), used by the VAT Engine's
 * `resolveEffectiveRate` when computing intelligence/returns over many
 * documents at once. */
export async function listRateHistoryForCompany(companyId: string): Promise<Map<number, VatRateHistoryEntry[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_rate_history")
    .select("*, vat_treatments!inner(company_id)")
    .eq("vat_treatments.company_id", companyId)
    .returns<VatRateHistoryRow[]>();
  if (error) throw error;

  const byTreatment = new Map<number, VatRateHistoryEntry[]>();
  for (const row of data.map(vatRateHistoryFromRow)) {
    const group = byTreatment.get(row.vatTreatmentId) ?? [];
    group.push(row);
    byTreatment.set(row.vatTreatmentId, group);
  }
  return byTreatment;
}

/** Closes the currently-open history row (sets `effective_to` to the
 * day before `effectiveFrom`) and opens a new one at the new rate —
 * real effective-dated history, never a silent overwrite. Also updates
 * `vat_treatments.rate`, the live convenience cache every existing
 * caller (Sales/Purchasing/Inventory approve-and-post) already reads. */
export async function changeRate(vatTreatmentId: number, newRate: number, effectiveFrom: string, performedBy = "System"): Promise<VatRateHistoryEntry> {
  const supabase = await createClient();

  const { data: openRow, error: openError } = await supabase
    .from("vat_rate_history")
    .select("id, effective_from")
    .eq("vat_treatment_id", vatTreatmentId)
    .is("effective_to", null)
    .maybeSingle<{ id: number; effective_from: string }>();
  if (openError) throw openError;

  if (openRow && openRow.effective_from < effectiveFrom) {
    const dayBefore = new Date(Date.parse(effectiveFrom) - 86_400_000).toISOString().slice(0, 10);
    const { error: closeError } = await supabase.from("vat_rate_history").update({ effective_to: dayBefore }).eq("id", openRow.id);
    if (closeError) throw closeError;
  }

  const { data, error } = await supabase
    .from("vat_rate_history")
    .insert({ vat_treatment_id: vatTreatmentId, rate: newRate, effective_from: effectiveFrom, created_by: performedBy })
    .select("*")
    .single<VatRateHistoryRow>();
  if (error) throw error;

  const { error: cacheError } = await supabase.from("vat_treatments").update({ rate: newRate }).eq("id", vatTreatmentId);
  if (cacheError) throw cacheError;

  return vatRateHistoryFromRow(data);
}
