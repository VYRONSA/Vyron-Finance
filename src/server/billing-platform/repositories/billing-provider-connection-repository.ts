/**
 * Repository for `billing_provider_connections` (migration `0049`) —
 * the honest "Not Connected"/"Connected"/"Error" status the Customer
 * Portal and Internal Console both read, mirroring
 * `integration-connection-repository.ts`'s established shape.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { billingProviderConnectionFromRow, type BillingProviderConnectionRow } from "../mappers";
import type { BillingProviderConnection, BillingProviderConnectionStatus } from "../types";

export async function getProviderConnection(providerName: "stripe"): Promise<BillingProviderConnection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_provider_connections").select("*").eq("provider_name", providerName).maybeSingle<BillingProviderConnectionRow>();
  if (error) throw error;
  return data ? billingProviderConnectionFromRow(data) : null;
}

/** No client write policy exists on this table (migration `0049` —
 * platform-scope read only). Takes an admin client, the same deliberate
 * exception `webhook-event-repository.ts` makes — this is only ever
 * called from Sub-Phase 8's Stripe connection-verification step, which
 * has no meaningful "acting user" to scope an RLS write policy to. */
export async function setProviderConnectionStatus(supabase: SupabaseClient, providerName: "stripe", status: BillingProviderConnectionStatus, notes: string): Promise<BillingProviderConnection> {
  const { data, error } = await supabase
    .from("billing_provider_connections")
    .update({ status, notes, connected_at: status === "Connected" ? new Date().toISOString() : null, last_verified_at: new Date().toISOString() })
    .eq("provider_name", providerName)
    .select("*")
    .single<BillingProviderConnectionRow>();
  if (error) throw error;
  return billingProviderConnectionFromRow(data);
}
