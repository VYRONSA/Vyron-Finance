-- Commercial Billing Platform — Sub-Phase 0, part 5 of 6. Provider
-- connection status, honestly "Not Connected" until Sub-Phase 8 makes
-- it real (same discipline as `integration_connections`,
-- 0012_inventory_platform.sql/0044 — "no module may invent
-- information"), and the webhook event log whose unique constraint IS
-- the idempotency/replay-protection mechanism.
--
-- Deliberately NOT company-scoped, unlike `integration_connections`:
-- one Stripe account backs the whole VYRON FINANCE platform, not one
-- per company.

create table billing_provider_connections (
  id bigint generated always as identity primary key,
  provider_name text not null unique check (provider_name in ('stripe')),
  status text not null default 'Not Connected' check (status in ('Not Connected', 'Connected', 'Error')),
  connected_at timestamptz,
  last_verified_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);
insert into billing_provider_connections (provider_name) values ('stripe');

-- `unique (provider, provider_event_id)` is the idempotency/replay
-- defense: the webhook handler always attempts an insert first; a
-- conflict means "already seen," and the handler returns success
-- immediately without reprocessing — Stripe's own recommended pattern,
-- and a second, independent layer on top of Stripe's own signature
-- verification (defense in depth, matching this codebase's "never rely
-- on one layer alone" convention already applied to RLS + app-level
-- permission checks).
create table billing_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored', 'duplicate')),
  payload jsonb not null,
  signature_verified boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  retry_count int not null default 0,
  unique (provider, provider_event_id)
);
create index billing_webhook_events_status_idx on billing_webhook_events (status);

alter table billing_provider_connections enable row level security;
alter table billing_webhook_events enable row level security;

-- Platform-scope read only — this is operational/internal state, not
-- something a customer's Billing Portal needs to see row-by-row (the
-- Portal reads env-var/config-derived "is Stripe available" instead,
-- see STRIPE_PROVIDER.md). No write policy for either table: only the
-- webhook route (via `createAdminClient()`, no user session exists to
-- satisfy any RLS policy anyway) and the seed insert above ever write
-- here.
create policy "platform-scope roles can read provider connection status" on billing_provider_connections for select using (
  exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
create policy "platform-scope roles can read webhook events" on billing_webhook_events for select using (
  exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);
