/**
 * Repository layer for Asset Lifecycle Events — the full Acquisition/
 * Capitalisation/Improvement/Transfer/Revaluation/Impairment/Disposal/
 * WriteOff/Retirement history. See
 * supabase/migrations/0018_fixed_assets_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { assetLifecycleEventFromRow, type AssetLifecycleEventRow } from "@/server/assets/mappers";
import type { AssetLifecycleEvent, AssetLifecycleEventType } from "@/server/assets/types";

export async function listAssetLifecycleEvents(companyId: string, assetId: number): Promise<AssetLifecycleEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_lifecycle_events")
    .select("*")
    .eq("company_id", companyId)
    .eq("asset_id", assetId)
    .order("event_date", { ascending: false })
    .returns<AssetLifecycleEventRow[]>();
  if (error) throw error;
  return data.map(assetLifecycleEventFromRow);
}

export async function listAllAssetLifecycleEvents(companyId: string): Promise<AssetLifecycleEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_lifecycle_events")
    .select("*")
    .eq("company_id", companyId)
    .order("event_date", { ascending: false })
    .returns<AssetLifecycleEventRow[]>();
  if (error) throw error;
  return data.map(assetLifecycleEventFromRow);
}

export type NewAssetLifecycleEvent = {
  assetId: number;
  eventType: AssetLifecycleEventType;
  eventDate: string;
  description?: string;
  amount?: number;
  journalId?: number | null;
  metadata?: Record<string, unknown>;
  performedBy?: string;
};

export async function createAssetLifecycleEvent(companyId: string, input: NewAssetLifecycleEvent): Promise<AssetLifecycleEvent> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_lifecycle_events")
    .insert({
      company_id: companyId,
      asset_id: input.assetId,
      event_type: input.eventType,
      event_date: input.eventDate,
      description: input.description ?? "",
      amount: input.amount ?? 0,
      journal_id: input.journalId ?? null,
      metadata: input.metadata ?? {},
      performed_by: input.performedBy ?? "System",
    })
    .select("*")
    .single<AssetLifecycleEventRow>();
  if (error) throw error;
  return assetLifecycleEventFromRow(data);
}
