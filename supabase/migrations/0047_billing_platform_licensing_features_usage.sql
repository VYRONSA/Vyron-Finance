-- Commercial Billing Platform — Sub-Phase 0, part 3 of 6. Per-company
-- feature overrides, plus usage metering built aggregate-first from day
-- one — the exact fix pattern this codebase already had to apply,
-- twice, to the banking-automation summary engine after it was found
-- loading full transaction histories into application memory
-- (migrations 0039-0043). `usage_period_counters` is the ONLY table
-- `checkUsageLimit()` ever reads — a single indexed row lookup, never a
-- `count(*)`/reduce over a growing table. `usage_events` is an
-- append-only detail log for Commercial Reporting/debugging, explicitly
-- never on the hot path of a feature/limit check.

create table company_feature_overrides (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  feature_id bigint not null references feature_flags (id) on delete cascade,
  is_enabled boolean not null,
  reason text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (company_id, feature_id)
);
create index company_feature_overrides_company_id_idx on company_feature_overrides (company_id);

alter table company_feature_overrides enable row level security;
create policy "members can read their company's feature overrides" on company_feature_overrides for select using (user_can_access_company(company_id));
-- Overrides are a platform-operations action (Internal Billing Console
-- granting a one-off exception), not a company self-service action — no
-- company-scoped write policy; only a platform-scope role or the
-- `createAdminClient()` path may write. Platform-scope rows still pass
-- `user_can_access_company` (it has its own `company_id is null` branch),
-- so a platform-scope admin's session client can write here directly.
create policy "platform-scope roles can write feature overrides" on company_feature_overrides for all using (
  exists (select 1 from user_role_assignments ura where ura.user_id = auth.uid() and ura.company_id is null)
);

create table usage_period_counters (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  metric_key text not null check (metric_key in (
    'active_users', 'storage_mb', 'documents', 'communications', 'automation_runs',
    'ai_requests', 'api_requests', 'bank_imports', 'reports_generated', 'forecasts', 'financial_statements'
  )),
  period_start date not null, -- first day of the metering month
  counter_value numeric(18, 4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, metric_key, period_start)
);
create index usage_period_counters_company_period_idx on usage_period_counters (company_id, period_start);

create table usage_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  metric_key text not null,
  quantity numeric(18, 4) not null default 1,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index usage_events_company_metric_occurred_idx on usage_events (company_id, metric_key, occurred_at);

alter table usage_period_counters enable row level security;
alter table usage_events enable row level security;
create policy "members can read their company's usage" on usage_period_counters for select using (user_can_access_company(company_id));
create policy "members can read their company's usage events" on usage_events for select using (user_can_access_company(company_id));
-- No direct insert/update policy on either table for the plain session
-- client — every write goes through `fn_increment_usage_counter` below,
-- which does its own explicit access check once rather than relying on
-- a row-level policy evaluated per call.

-- The one controlled write path for both tables at once — a detail
-- event (for Commercial Reporting/debugging) and the aggregate counter
-- (the only thing `checkUsageLimit()` ever reads) in one atomic call.
-- `security definer` + one explicit `user_can_access_company()` check,
-- mirroring the established pattern (`assign_company_role`,
-- `fn_banking_automation_summary`) — callable by the normal session
-- client, since a user's own request recording usage against their own
-- company is a legitimate, routine action (not a privileged one),
-- gated so it can never write another tenant's usage.
create function fn_record_usage_event(p_company_id uuid, p_metric_key text, p_quantity numeric, p_metadata jsonb, p_occurred_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date := date_trunc('month', p_occurred_at)::date;
begin
  if not user_can_access_company(p_company_id) then
    raise exception 'not authorized for company %', p_company_id;
  end if;

  insert into usage_events (company_id, metric_key, quantity, metadata, occurred_at)
  values (p_company_id, p_metric_key, p_quantity, p_metadata, p_occurred_at);

  insert into usage_period_counters (company_id, metric_key, period_start, counter_value)
  values (p_company_id, p_metric_key, v_period_start, p_quantity)
  on conflict (company_id, metric_key, period_start)
  do update set counter_value = usage_period_counters.counter_value + excluded.counter_value, updated_at = now();
end;
$$;
