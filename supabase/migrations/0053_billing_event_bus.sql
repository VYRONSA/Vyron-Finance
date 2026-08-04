-- Commercial Billing Platform — Required Improvement: the Billing Event
-- Bus. "Every significant billing action must publish a business
-- event... The Communication Platform, Notification Centre, Operations
-- Centre, Audit Trail, and future VYRON products must all consume these
-- events. Never couple modules directly to Billing."
--
-- `billing_events` is the append-only log every published event lands
-- in — the literal Audit Trail consumer (a full, permanent, queryable
-- history of every billing action, same append-only discipline as
-- `subscription_status_history`/`gl_transactions`) — AND the durable
-- record a real in-process subscriber dispatch (see
-- `src/server/billing-platform/events/billing-event-bus.ts`) is layered
-- on top of, not a replacement for.

create table billing_events (
  id bigint generated always as identity primary key,
  company_id uuid references companies (id) on delete cascade, -- null for platform-wide events with no single owning company (none exist yet, but a real future case — e.g. a provider-level event)
  event_type text not null check (event_type in (
    'SubscriptionCreated', 'SubscriptionChanged', 'SubscriptionCancelled', 'TrialStarted', 'TrialExpired',
    'PaymentReceived', 'PaymentFailed', 'RefundIssued', 'CreditApplied', 'InvoiceGenerated',
    'SeatIncreased', 'FeatureEnabled', 'FeatureDisabled'
  )),
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index billing_events_company_id_occurred_at_idx on billing_events (company_id, occurred_at);
create index billing_events_event_type_idx on billing_events (event_type);

alter table billing_events enable row level security;
create policy "members can read their company's billing events" on billing_events for select using (
  company_id is null or user_can_access_company(company_id)
);
create policy "members can publish billing events for their own company" on billing_events for insert with check (
  company_id is null or user_can_access_company(company_id)
);
