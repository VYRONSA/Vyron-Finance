-- Phase 21C — Inbound Bank Statement Email processing. Resend delivers
-- webhooks at-least-once (the same event may be redelivered), so
-- processing must be idempotent — mirroring the architectural CONCEPT
-- already established by `billing_webhook_events` (0046), not reusing
-- that table directly (it is Stripe/billing-scoped by name and intent;
-- this is a distinct, unrelated inbound channel).
--
-- No accounting table is touched by this migration. `company_id` is
-- nullable and only ever set once recipient resolution succeeds — an
-- event that never resolves to a company (bad/unknown recipient) still
-- gets a row, so a redelivered "unknown recipient" event is recognized
-- as already-handled instead of being investigated twice.
--
-- This table has NO user-facing access at all — it is only ever read/
-- written by the webhook route via the service-role admin client
-- (there is no user session in a server-to-server webhook to authorize
-- against). RLS is enabled with zero policies, so even an anon/
-- authenticated Supabase client is denied by default; only the
-- service-role key (which bypasses RLS entirely, per Postgres/Supabase
-- design) can reach this table.

create table resend_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null default 'resend',
  provider_event_id text not null,
  event_type text not null,
  company_id uuid references companies (id) on delete set null,
  status text not null default 'received' check (status in ('received', 'processed', 'rejected', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  constraint resend_webhook_events_provider_event_id_key unique (provider, provider_event_id)
);

create index resend_webhook_events_company_id_idx on resend_webhook_events (company_id);

alter table resend_webhook_events enable row level security;
