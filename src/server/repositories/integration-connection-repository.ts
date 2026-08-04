/**
 * Repository layer for the Integration Centre's connection-status
 * registry. No real synchronisation happens here — see
 * `integration-service.ts`'s module docstring — this is the honest
 * "Not Connected" status the UI reads, not a fabricated one.
 */

import { createClient } from "@/lib/supabase/server";
import { integrationConnectionFromRow, type IntegrationConnectionRow } from "@/server/inventory/mappers";
import type { IntegrationConnection, IntegrationSystemName } from "@/server/inventory/types";

export async function listIntegrationConnections(companyId: string): Promise<IntegrationConnection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("company_id", companyId)
    .returns<IntegrationConnectionRow[]>();
  if (error) throw error;
  return data.map(integrationConnectionFromRow);
}

/** Ensures a row exists for the given system (created honestly "Not
 * Connected" the first time it's asked for), then returns it —
 * idempotent so the UI never has to special-case "no row yet". */
export async function ensureIntegrationConnection(companyId: string, systemName: IntegrationSystemName): Promise<IntegrationConnection> {
  const supabase = await createClient();
  const { data: existing, error: selectError } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("company_id", companyId)
    .eq("system_name", systemName)
    .maybeSingle<IntegrationConnectionRow>();
  if (selectError) throw selectError;
  if (existing) return integrationConnectionFromRow(existing);

  const { data: created, error: insertError } = await supabase
    .from("integration_connections")
    .insert({ company_id: companyId, system_name: systemName })
    .select("*")
    .single<IntegrationConnectionRow>();
  if (insertError) throw insertError;
  return integrationConnectionFromRow(created);
}
