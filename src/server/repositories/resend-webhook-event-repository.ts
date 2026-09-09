/**
 * Repository layer for Phase 21C's inbound-webhook idempotency table
 * (`resend_webhook_events`, see
 * supabase/migrations/0079_resend_webhook_events.sql). Uses the
 * service-role admin client (`@/lib/supabase/admin`), NOT the
 * session-scoped `@/lib/supabase/server` client — a server-to-server
 * webhook has no user session to authorize against (per this app's own
 * `requireSession()`/RLS model), and this table's own RLS has zero
 * policies for exactly that reason: only the service-role key can ever
 * reach it, matching the established precedent in
 * `src/lib/supabase/admin.ts` ("the one client in the codebase allowed
 * to bypass RLS... only where Supabase itself requires elevated
 * privilege").
 *
 * Phase 21K — this table/file is genuinely multi-provider now (Resend
 * webhook deliveries AND IMAP-polled messages both use it for
 * idempotency), despite the Resend-specific name. The `provider` column
 * has no CHECK constraint restricting its values — only `(provider,
 * provider_event_id)`'s uniqueness matters — so this required no schema
 * change, just widening `findResendWebhookEvent`/`insertResendWebhookEvent`
 * to accept which provider they're querying/inserting for (defaulting to
 * `"resend"`, so every existing Resend call site is byte-for-byte
 * unchanged). The name is left as-is rather than renamed this phase —
 * the exact same trade-off this codebase already made for `banking_rules`
 * after it was widened to non-Banking domains (migration `0014`'s own
 * docstring: "a cosmetic rename... judged not worth the regression risk
 * under this module's explicit 'No regressions' completion criterion").
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type ResendWebhookEventStatus = "received" | "processed" | "rejected" | "failed";

export type ResendWebhookEventRecord = {
  id: number;
  provider: string;
  providerEventId: string;
  eventType: string;
  companyId: string | null;
  status: ResendWebhookEventStatus;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
};

type ResendWebhookEventRow = {
  id: number;
  provider: string;
  provider_event_id: string;
  event_type: string;
  company_id: string | null;
  status: string;
  received_at: string;
  processed_at: string | null;
  error: string | null;
};

function fromRow(row: ResendWebhookEventRow): ResendWebhookEventRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    companyId: row.company_id,
    status: row.status as ResendWebhookEventStatus,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    error: row.error,
  };
}

export async function findResendWebhookEvent(providerEventId: string, provider = "resend"): Promise<ResendWebhookEventRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("resend_webhook_events")
    .select("*")
    .eq("provider", provider)
    .eq("provider_event_id", providerEventId)
    .maybeSingle<ResendWebhookEventRow>();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

export type InsertResendWebhookEventResult = {
  record: ResendWebhookEventRecord;
  /** false when this call LOST a race against a concurrent delivery of
   * the same event — see the call site's own handling below. */
  inserted: boolean;
};

/** Resend delivers at-least-once, so two deliveries of the identical
 * event can genuinely arrive close enough together to both pass the
 * caller's own `findResendWebhookEvent` check before either has
 * inserted — the unique constraint on `(provider, provider_event_id)`
 * is the real, database-enforced idempotency guarantee, this function
 * just makes losing that race a normal, handled outcome (`inserted:
 * false`) instead of an uncaught Postgres 23505 surfacing as a 500. */
export async function insertResendWebhookEvent(providerEventId: string, eventType: string, provider = "resend"): Promise<InsertResendWebhookEventResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("resend_webhook_events")
    .insert({ provider, provider_event_id: providerEventId, event_type: eventType })
    .select("*")
    .single<ResendWebhookEventRow>();
  if (error) {
    if (error.code === "23505") {
      const existing = await findResendWebhookEvent(providerEventId, provider);
      if (existing) return { record: existing, inserted: false };
    }
    throw error;
  }
  return { record: fromRow(data), inserted: true };
}

export async function setResendWebhookEventCompany(id: number, companyId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("resend_webhook_events").update({ company_id: companyId }).eq("id", id);
  if (error) throw error;
}

export async function completeResendWebhookEvent(id: number, status: "processed" | "rejected" | "failed", errorMessage: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("resend_webhook_events")
    .update({ status, processed_at: new Date().toISOString(), error: errorMessage })
    .eq("id", id);
  if (error) throw error;
}
