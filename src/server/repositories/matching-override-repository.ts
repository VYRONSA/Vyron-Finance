/**
 * Repository layer for Matching Overrides — the audit trail every manual
 * correction across the Matching Platform writes to. See
 * supabase/migrations/0023_matching_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { matchingOverrideFromRow, type MatchingOverrideRow } from "@/server/matching/mappers";
import type { MatchingOverride } from "@/server/matching/types";

export type NewMatchingOverride = { itemType: string; itemId: number; fieldName: string; oldValue: string | null; newValue: string | null; reason: string; performedBy?: string };

export async function recordOverride(companyId: string, input: NewMatchingOverride): Promise<MatchingOverride> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matching_overrides")
    .insert({
      company_id: companyId,
      item_type: input.itemType,
      item_id: input.itemId,
      field_name: input.fieldName,
      old_value: input.oldValue,
      new_value: input.newValue,
      reason: input.reason,
      performed_by: input.performedBy ?? "System",
    })
    .select("*")
    .single<MatchingOverrideRow>();
  if (error) throw error;
  return matchingOverrideFromRow(data);
}

export async function listOverridesForItem(companyId: string, itemType: string, itemId: number): Promise<MatchingOverride[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matching_overrides")
    .select("*")
    .eq("company_id", companyId)
    .eq("item_type", itemType)
    .eq("item_id", itemId)
    .order("performed_at", { ascending: false })
    .returns<MatchingOverrideRow[]>();
  if (error) throw error;
  return data.map(matchingOverrideFromRow);
}

export async function listRecentOverrides(companyId: string, limit = 50): Promise<MatchingOverride[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matching_overrides")
    .select("*")
    .eq("company_id", companyId)
    .order("performed_at", { ascending: false })
    .limit(limit)
    .returns<MatchingOverrideRow[]>();
  if (error) throw error;
  return data.map(matchingOverrideFromRow);
}
