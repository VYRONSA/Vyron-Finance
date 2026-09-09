/**
 * Repository layer for Find & Recode's saved filter presets
 * (supabase/migrations/0080_find_and_recode_filter_presets.sql). Personal
 * to the signed-in user, company-scoped — every query below is
 * explicitly filtered on BOTH `company_id` and `user_id`, the same
 * "explicit filter AND RLS enforces it too" convention this codebase
 * already uses everywhere else (RLS is defense-in-depth, not the only
 * layer).
 */

import { createClient } from "@/lib/supabase/server";
import type { TransactionExplorerFilters } from "@/server/accounting/types";

export type FindAndRecodeFilterPreset = {
  id: number;
  companyId: string;
  userId: string;
  name: string;
  filters: TransactionExplorerFilters;
  createdAt: string;
  updatedAt: string;
};

type PresetRow = {
  id: number;
  company_id: string;
  user_id: string;
  name: string;
  filters: TransactionExplorerFilters;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PresetRow): FindAndRecodeFilterPreset {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    name: row.name,
    filters: row.filters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Cheap by construction — no transaction data is ever touched, just
 * this small table's own rows. */
export async function listFindAndRecodePresets(companyId: string, userId: string): Promise<FindAndRecodeFilterPreset[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("find_and_recode_filter_presets")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .order("name")
    .returns<PresetRow[]>();
  if (error) throw error;
  return data.map(fromRow);
}

export async function getFindAndRecodePreset(companyId: string, userId: string, presetId: number): Promise<FindAndRecodeFilterPreset | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("find_and_recode_filter_presets")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("id", presetId)
    .maybeSingle<PresetRow>();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

export async function createFindAndRecodePreset(
  companyId: string,
  userId: string,
  name: string,
  filters: TransactionExplorerFilters,
): Promise<FindAndRecodeFilterPreset> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("find_and_recode_filter_presets")
    .insert({ company_id: companyId, user_id: userId, name, filters })
    .select("*")
    .single<PresetRow>();
  if (error) throw error;
  return fromRow(data);
}

export async function renameFindAndRecodePreset(companyId: string, userId: string, presetId: number, name: string): Promise<FindAndRecodeFilterPreset | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("find_and_recode_filter_presets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("id", presetId)
    .select("*")
    .maybeSingle<PresetRow>();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

export async function deleteFindAndRecodePreset(companyId: string, userId: string, presetId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("find_and_recode_filter_presets").delete().eq("company_id", companyId).eq("user_id", userId).eq("id", presetId);
  if (error) throw error;
}
