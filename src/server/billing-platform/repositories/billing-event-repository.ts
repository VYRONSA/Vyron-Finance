/** Repository for `billing_events` (migration `0053`) — the Billing
 * Event Bus's durable, append-only log. */

import { createClient } from "@/lib/supabase/server";
import { billingEventFromRow, type BillingEventRow } from "../mappers";
import type { BillingEvent, BillingEventType } from "../types";

export async function insertBillingEvent(companyId: string | null, eventType: BillingEventType, payload: Record<string, unknown>, occurredAtIso: string): Promise<BillingEvent> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_events")
    .insert({ company_id: companyId, event_type: eventType, payload, occurred_at: occurredAtIso })
    .select("*")
    .single<BillingEventRow>();
  if (error) throw error;
  return billingEventFromRow(data);
}

export async function listBillingEvents(companyId: string, limit = 100): Promise<BillingEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_events").select("*").eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as BillingEventRow[];
  return rows.map(billingEventFromRow);
}

/** Platform-wide audit trail — every billing event across every
 * company, for the Internal Billing Console. Same RLS-only access
 * model as `subscription-repository.ts::listAllSubscriptions`. */
export async function listAllBillingEvents(limit = 200): Promise<BillingEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_events").select("*").order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as BillingEventRow[];
  return rows.map(billingEventFromRow);
}
