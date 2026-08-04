/**
 * Repository for `billing_webhook_events` (migration `0049`). No client
 * write policy exists — this table is only ever written by the webhook
 * route via `createAdminClient()` (no user session to authenticate a
 * webhook call as), reads are platform-scope only. The insert-first,
 * `unique (provider, provider_event_id)`-driven idempotency check lives
 * here (`recordWebhookEventIfNew`), reused as-is by
 * `billing-engine.ts::processWebhookEvent`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { billingWebhookEventFromRow, type BillingWebhookEventRow } from "../mappers";
import type { BillingWebhookEvent } from "../types";

export type RecordWebhookEventResult = { isNew: true; event: BillingWebhookEvent } | { isNew: false; event: BillingWebhookEvent };

/** Takes an already-constructed admin client (the webhook route has no
 * session, so it builds one `createAdminClient()` and threads it
 * through) rather than constructing its own — every other repository in
 * this codebase creates its own client per call because a real user
 * session exists; this is the one deliberate exception, per
 * `admin.ts`'s widened, disclosed scope (see migration `0046`'s write-
 * path comment). */
export async function recordWebhookEventIfNew(
  supabase: SupabaseClient,
  input: { provider: string; providerEventId: string; eventType: string; payload: unknown; signatureVerified: boolean },
): Promise<RecordWebhookEventResult> {
  const { data, error } = await supabase
    .from("billing_webhook_events")
    .insert({ provider: input.provider, provider_event_id: input.providerEventId, event_type: input.eventType, payload: input.payload, signature_verified: input.signatureVerified })
    .select("*")
    .maybeSingle<BillingWebhookEventRow>();

  if (error) {
    if (error.code === "23505") {
      // unique_violation on (provider, provider_event_id) — already seen.
      const { data: existing, error: fetchError } = await supabase
        .from("billing_webhook_events")
        .select("*")
        .eq("provider", input.provider)
        .eq("provider_event_id", input.providerEventId)
        .single<BillingWebhookEventRow>();
      if (fetchError) throw fetchError;
      return { isNew: false, event: billingWebhookEventFromRow(existing) };
    }
    throw error;
  }
  return { isNew: true, event: billingWebhookEventFromRow(data!) };
}

export async function markWebhookEventProcessed(supabase: SupabaseClient, id: number, status: BillingWebhookEvent["status"], errorMessage: string | null): Promise<void> {
  const { error } = await supabase.from("billing_webhook_events").update({ status, processed_at: new Date().toISOString(), error_message: errorMessage }).eq("id", id);
  if (error) throw error;
}

export async function listWebhookEvents(limit = 100): Promise<BillingWebhookEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_webhook_events").select("*").order("received_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as BillingWebhookEventRow[];
  return rows.map(billingWebhookEventFromRow);
}
