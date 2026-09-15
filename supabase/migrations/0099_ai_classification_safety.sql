-- AI classification safety: attempt log, per-transaction queue state,
-- shared provider circuit breaker, per-company daily request fuse,
-- internal provider-request metric, Suspended automation tasks, and
-- de-duplicated operations alerts.
--
-- Why (production investigation, 2026-09-15): the AiClassificationSweep
-- re-asked the AI about the same 20 oldest Unallocated transactions every
-- ~2 minutes (~11,000 provider requests/day), because a "no confident
-- suggestion" left a transaction exactly as eligible as before, nothing
-- recorded that it had been attempted, and the scheduler rescheduled in 2
-- minutes whenever a full batch came back. When the provider path later
-- failed, the task failed every hour forever and raised a new critical
-- alert every time.
--
-- What this migration does NOT do:
--   * it never modifies ae_bank_transactions (queue state is a separate
--     table) or any other accounting data;
--   * it does not change customer metering or licensing
--     (fn_record_usage_event is untouched; `ai_provider_requests` is an
--     internal metric only);
--   * it does not resume, pause or otherwise change any existing task.
--
-- Every write to the new tables goes through the security-definer
-- functions below, executable by the service role only. Company members
-- may READ their own company's attempts and queue state; nobody but those
-- functions can read or write the circuit state or the daily fuse.
--
-- Concurrency: a provider request is only sent after fn_ai_classification_gate
-- has atomically RESERVED one of the company's 100 daily requests (a
-- conditional UPDATE on one per-company-per-day row), so concurrent
-- callers can never exceed the fuse; an open circuit's single probe is
-- claimed with a conditional UPDATE, so exactly one caller gets it.
--
-- Re-runnable: if-not-exists / create-or-replace / drop-if-exists.

-- ---------------------------------------------------------------------
-- 1. One row per AI classification attempt.
-- ---------------------------------------------------------------------
create table if not exists ai_classification_attempts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  transaction_id bigint not null references ae_bank_transactions (id) on delete cascade,
  task_run_id bigint references automation_task_runs (id) on delete set null,
  source text not null check (source in ('sweep', 'import', 'manual')),
  attempted_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  outcome text not null check (outcome in (
    'suggested', 'allocated', 'no_confidence', 'invalid_response', 'provider_error', 'evidence_error', 'write_error'
  )),
  -- true only when a request actually reached (or was in flight to) the
  -- provider — what the internal `ai_provider_requests` metric counts.
  provider_request_made boolean not null,
  provider text not null default 'vercel-ai-gateway',
  model text,
  error_category text,
  http_status integer,
  -- Sanitized by the application (credentials stripped) and capped here.
  provider_message text check (provider_message is null or char_length(provider_message) <= 300),
  -- Only what the provider/SDK actually supplied (tokens, cost); never estimated.
  usage jsonb,
  performed_by text not null default 'VYRON AI'
);

create index if not exists ai_classification_attempts_company_time_idx on ai_classification_attempts (company_id, attempted_at desc);
create index if not exists ai_classification_attempts_provider_requests_idx on ai_classification_attempts (company_id, attempted_at) where provider_request_made;
create index if not exists ai_classification_attempts_transaction_idx on ai_classification_attempts (transaction_id, attempted_at desc);
create index if not exists ai_classification_attempts_task_run_idx on ai_classification_attempts (task_run_id) where task_run_id is not null;

alter table ai_classification_attempts enable row level security;
drop policy if exists "members can read their company's AI classification attempts" on ai_classification_attempts;
create policy "members can read their company's AI classification attempts" on ai_classification_attempts
  for select using (user_can_access_company(company_id));
-- Nobody writes directly (the functions below do); reads are granted
-- explicitly so they never depend on the project's default privileges.
revoke all on table ai_classification_attempts from public, anon, authenticated, service_role;
grant select on table ai_classification_attempts to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Per-transaction queue state (no row = never attempted).
--    active             attempted, still eligible (e.g. after a provider outage)
--    cooldown           not selected before next_eligible_at
--    needs_human_review never selected automatically again
--    resolved           a suggestion/allocation was written; never re-selected automatically
-- ---------------------------------------------------------------------
create table if not exists ai_classification_queue_state (
  transaction_id bigint primary key references ae_bank_transactions (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  state text not null default 'active' check (state in ('active', 'cooldown', 'needs_human_review', 'resolved')),
  attempt_count integer not null default 0,
  -- unusable results (no confidence, invalid answer, an answer that could
  -- not be saved); 1 -> cooldown, 2 -> human review
  unusable_result_count integer not null default 0,
  last_attempt_at timestamptz,
  last_outcome text,
  next_eligible_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ai_classification_queue_state_company_idx on ai_classification_queue_state (company_id, state, next_eligible_at);

alter table ai_classification_queue_state enable row level security;
drop policy if exists "members can read their company's AI classification queue state" on ai_classification_queue_state;
create policy "members can read their company's AI classification queue state" on ai_classification_queue_state
  for select using (user_can_access_company(company_id));
revoke all on table ai_classification_queue_state from public, anon, authenticated, service_role;
grant select on table ai_classification_queue_state to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Shared provider circuit breaker (one row per scope).
-- ---------------------------------------------------------------------
create table if not exists ai_provider_circuit_state (
  scope text primary key,
  state text not null default 'closed' check (state in ('closed', 'open')),
  consecutive_timeouts integer not null default 0,
  consecutive_provider_failures integer not null default 0,
  opened_at timestamptz,
  open_reason text,
  last_error_category text,
  last_http_status integer,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 300),
  next_probe_at timestamptz,
  probe_backoff_seconds integer not null default 3600,
  probe_in_flight_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table ai_provider_circuit_state enable row level security;
-- No policies and no table privileges for any API role.
revoke all on table ai_provider_circuit_state from public, anon, authenticated, service_role;

insert into ai_provider_circuit_state (scope) values ('transaction-classification') on conflict (scope) do nothing;

-- ---------------------------------------------------------------------
-- 4. Per-company daily fuse: provider requests reserved per UTC day.
--    Incremented atomically by the gate before a request is sent, and
--    given back when an attempt turns out not to have reached the
--    provider — so reserved_requests is always >= requests actually made.
-- ---------------------------------------------------------------------
create table if not exists ai_provider_daily_usage (
  company_id uuid not null references companies (id) on delete cascade,
  usage_day date not null,
  reserved_requests integer not null default 0 check (reserved_requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, usage_day)
);

alter table ai_provider_daily_usage enable row level security;
revoke all on table ai_provider_daily_usage from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Internal provider-request metric. Customer metering is unchanged:
--    this key is not a customer quota and fn_record_usage_event is not
--    modified. Recorded only through fn_record_internal_usage_event.
-- ---------------------------------------------------------------------
alter table usage_period_counters drop constraint if exists usage_period_counters_metric_key_check;
alter table usage_period_counters add constraint usage_period_counters_metric_key_check check (metric_key in (
  'communications', 'automation_runs', 'ai_requests', 'api_requests',
  'bank_imports', 'reports_generated', 'forecasts', 'financial_statements', 'scheduled_jobs',
  'ai_provider_requests'
));

create or replace function fn_record_internal_usage_event(
  p_company_id uuid, p_metric_key text, p_quantity numeric, p_metadata jsonb, p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_metric_key not in ('ai_provider_requests') then
    raise exception 'fn_record_internal_usage_event: "%" is not an internal metric', p_metric_key;
  end if;

  insert into usage_events (company_id, metric_key, quantity, metadata, occurred_at)
  values (p_company_id, p_metric_key, p_quantity, coalesce(p_metadata, '{}'::jsonb), p_occurred_at);

  insert into usage_period_counters (company_id, metric_key, period_start, counter_value)
  values (p_company_id, p_metric_key, date_trunc('month', p_occurred_at)::date, p_quantity)
  on conflict (company_id, metric_key, period_start)
  do update set counter_value = usage_period_counters.counter_value + excluded.counter_value, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The gate checked before EVERY provider request, for one transaction.
--    Returns {"decision": "allow" | "probe" | "held" | "circuit_open" | "daily_cap", ...}.
--      held          automatic paths (sweep, import) never re-ask a
--                    transaction in cooldown, awaiting human review, or
--                    already resolved; "Classify with AI" (manual) is the
--                    explicit retry and is not held
--      circuit_open  nothing is sent while the circuit is open, except
--                    exactly one probe once next_probe_at has passed
--      daily_cap     the company's 100 requests for this UTC day are used
--    allow/probe RESERVE one of the day's requests (atomic), so the fuse
--    holds under any concurrency.
-- ---------------------------------------------------------------------
create or replace function fn_ai_classification_gate(
  p_company_id uuid,
  p_transaction_id bigint,
  p_source text,
  p_now timestamptz default now(),
  p_daily_cap integer default 100,
  p_scope text default 'transaction-classification'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The 100/day fuse is fixed here: a caller may ask for a lower cap, never a higher one.
  v_cap integer := least(greatest(coalesce(p_daily_cap, 100), 0), 100);
  v_day date := (p_now at time zone 'UTC')::date;
  v_company uuid;
  q ai_classification_queue_state%rowtype;
  c ai_provider_circuit_state%rowtype;
  v_reserved integer;
  v_probe boolean := false;
  v_claimed text;
begin
  if p_source is null or p_source not in ('sweep', 'import', 'manual') then
    raise exception 'fn_ai_classification_gate: unknown source "%"', p_source;
  end if;
  select company_id into v_company from ae_bank_transactions where id = p_transaction_id;
  if v_company is null or v_company <> p_company_id then
    raise exception 'fn_ai_classification_gate: transaction % does not belong to company %', p_transaction_id, p_company_id;
  end if;

  -- 1. Queue hold (automatic paths only).
  if p_source <> 'manual' then
    select * into q from ai_classification_queue_state where transaction_id = p_transaction_id;
    if found and (q.state in ('needs_human_review', 'resolved') or (q.next_eligible_at is not null and q.next_eligible_at > p_now)) then
      return jsonb_build_object('decision', 'held', 'queue_state', q.state, 'next_eligible_at', q.next_eligible_at,
        'circuit_state', null, 'open_reason', null, 'next_probe_at', null, 'requests_today', null, 'daily_cap', v_cap);
    end if;
  end if;

  -- 2. Circuit breaker.
  select * into c from ai_provider_circuit_state where scope = p_scope;
  if not found then
    insert into ai_provider_circuit_state (scope) values (p_scope) on conflict (scope) do nothing;
    select * into c from ai_provider_circuit_state where scope = p_scope;
  end if;
  if c.state = 'open' then
    if c.next_probe_at is null or p_now < c.next_probe_at
       or (c.probe_in_flight_until is not null and p_now < c.probe_in_flight_until) then
      return jsonb_build_object('decision', 'circuit_open', 'queue_state', null, 'next_eligible_at', null,
        'circuit_state', 'open', 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at,
        'requests_today', null, 'daily_cap', v_cap);
    end if;
    v_probe := true;
  end if;

  -- 3. Reserve one of today's requests. The conditional UPDATE re-checks
  --    the count under the row lock, so concurrent callers can never
  --    reserve more than the cap between them.
  insert into ai_provider_daily_usage (company_id, usage_day) values (p_company_id, v_day)
  on conflict (company_id, usage_day) do nothing;
  update ai_provider_daily_usage
  set reserved_requests = reserved_requests + 1, updated_at = now()
  where company_id = p_company_id and usage_day = v_day and reserved_requests < v_cap
  returning reserved_requests into v_reserved;
  if v_reserved is null then
    return jsonb_build_object('decision', 'daily_cap', 'queue_state', null, 'next_eligible_at', null,
      'circuit_state', c.state, 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at,
      'requests_today', (select reserved_requests from ai_provider_daily_usage where company_id = p_company_id and usage_day = v_day),
      'daily_cap', v_cap);
  end if;

  -- 4. An open circuit lets exactly one probe through: claim it atomically.
  if v_probe then
    update ai_provider_circuit_state
    set probe_in_flight_until = p_now + interval '10 minutes', updated_at = now()
    where scope = p_scope and state = 'open' and next_probe_at is not null and next_probe_at <= p_now
      and (probe_in_flight_until is null or probe_in_flight_until <= p_now)
    returning scope into v_claimed;
    if v_claimed is null then
      select * into c from ai_provider_circuit_state where scope = p_scope;
      if c.state = 'open' then
        -- Another caller holds the probe: give the reserved request back.
        update ai_provider_daily_usage set reserved_requests = greatest(reserved_requests - 1, 0), updated_at = now()
        where company_id = p_company_id and usage_day = v_day;
        return jsonb_build_object('decision', 'circuit_open', 'queue_state', null, 'next_eligible_at', null,
          'circuit_state', 'open', 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at,
          'requests_today', null, 'daily_cap', v_cap);
      end if;
      -- A successful probe closed it in the meantime: an ordinary request.
      v_probe := false;
    end if;
  end if;

  return jsonb_build_object('decision', case when v_probe then 'probe' else 'allow' end, 'queue_state', null, 'next_eligible_at', null,
    'circuit_state', case when v_probe then 'open' else 'closed' end, 'open_reason', case when v_probe then c.open_reason end,
    'next_probe_at', case when v_probe then c.next_probe_at end, 'requests_today', v_reserved - 1, 'daily_cap', v_cap);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Records one attempt atomically: attempt row, queue state, internal
--    provider-request usage (only when a request was made), the daily
--    fuse (a reservation that sent nothing is given back) and the circuit
--    breaker transition.
--
--    Circuit signals (decided by the application from the error category):
--      success           the provider responded (incl. no-confidence/invalid)
--      auth              401/402/403/404/missing key/configuration -> open now
--      timeout           3 consecutive -> open
--      provider_failure  5 consecutive 5xx/provider/network failures -> open
--      rate_limit        no change while closed
--      none              no provider interaction (e.g. evidence read failed)
--    While open, only the PROBE's failure (p_probe) moves the backoff —
--    doubling it, capped at 24 hours; a late failure from a request that
--    was already in flight when the circuit opened changes nothing but the
--    last-error details. Any success closes the circuit.
-- ---------------------------------------------------------------------
create or replace function fn_ai_classification_record_attempt(
  p_company_id uuid,
  p_transaction_id bigint,
  p_task_run_id bigint,
  p_source text,
  p_outcome text,
  p_provider_request_made boolean,
  p_model text,
  p_error_category text,
  p_http_status integer,
  p_provider_message text,
  p_usage jsonb,
  p_duration_ms integer,
  p_performed_by text,
  p_circuit_signal text,
  p_now timestamptz default now(),
  p_scope text default 'transaction-classification',
  p_probe boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  q ai_classification_queue_state%rowtype;
  v_unusable integer;
  v_state text;
  v_next timestamptz;
  c ai_provider_circuit_state%rowtype;
  v_message text := left(p_provider_message, 300);
  v_backoff integer;
begin
  select company_id into v_company from ae_bank_transactions where id = p_transaction_id;
  if v_company is null or v_company <> p_company_id then
    raise exception 'fn_ai_classification_record_attempt: transaction % does not belong to company %', p_transaction_id, p_company_id;
  end if;
  if p_circuit_signal not in ('success', 'auth', 'timeout', 'provider_failure', 'rate_limit', 'none') then
    raise exception 'fn_ai_classification_record_attempt: unknown circuit signal "%"', p_circuit_signal;
  end if;

  insert into ai_classification_attempts (
    company_id, transaction_id, task_run_id, source, attempted_at, duration_ms, outcome, provider_request_made,
    model, error_category, http_status, provider_message, usage, performed_by
  ) values (
    p_company_id, p_transaction_id, p_task_run_id, p_source, p_now, p_duration_ms, p_outcome, p_provider_request_made,
    p_model, p_error_category, p_http_status, v_message, p_usage, coalesce(p_performed_by, 'VYRON AI')
  );

  -- Queue state -------------------------------------------------------
  select * into q from ai_classification_queue_state where transaction_id = p_transaction_id for update;
  v_unusable := coalesce(q.unusable_result_count, 0);

  if p_outcome in ('suggested', 'allocated') then
    v_state := 'resolved';
    v_next := null;
  elsif p_outcome in ('no_confidence', 'invalid_response') then
    v_unusable := v_unusable + 1;
    if v_unusable >= 2 then
      v_state := 'needs_human_review';
      v_next := null;
    else
      v_state := 'cooldown';
      v_next := p_now + interval '7 days';
    end if;
  elsif p_outcome = 'write_error' then
    -- The provider answered but the suggestion could not be saved: an
    -- unusable result, so it can never be re-requested indefinitely.
    v_unusable := v_unusable + 1;
    if v_unusable >= 2 then
      v_state := 'needs_human_review';
      v_next := null;
    else
      v_state := 'cooldown';
      v_next := greatest(coalesce(q.next_eligible_at, p_now), p_now + interval '1 day');
    end if;
  elsif p_outcome = 'evidence_error' then
    -- No provider request was made; retry the database read tomorrow.
    if q.state = 'needs_human_review' then
      v_state := q.state;
      v_next := null;
    else
      v_state := 'cooldown';
      v_next := greatest(coalesce(q.next_eligible_at, p_now), p_now + interval '1 day');
    end if;
  else
    -- provider_error: not the transaction's fault; keep any existing hold.
    v_state := case when q.state in ('cooldown', 'needs_human_review') then q.state else 'active' end;
    v_next := case when q.state in ('cooldown', 'needs_human_review') then q.next_eligible_at else null end;
  end if;

  insert into ai_classification_queue_state (
    transaction_id, company_id, state, attempt_count, unusable_result_count, last_attempt_at, last_outcome, next_eligible_at, updated_at
  ) values (p_transaction_id, p_company_id, v_state, 1, v_unusable, p_now, p_outcome, v_next, now())
  on conflict (transaction_id) do update set
    state = excluded.state,
    attempt_count = ai_classification_queue_state.attempt_count + 1,
    unusable_result_count = excluded.unusable_result_count,
    last_attempt_at = excluded.last_attempt_at,
    last_outcome = excluded.last_outcome,
    next_eligible_at = excluded.next_eligible_at,
    updated_at = now();

  -- Internal usage and the daily fuse ----------------------------------
  if p_provider_request_made then
    perform fn_record_internal_usage_event(
      p_company_id, 'ai_provider_requests', 1,
      jsonb_build_object('source', p_source, 'outcome', p_outcome, 'transaction_id', p_transaction_id,
        'task_run_id', p_task_run_id, 'error_category', p_error_category),
      p_now);
  else
    -- The gate reserved a request that was never sent: give it back.
    update ai_provider_daily_usage set reserved_requests = greatest(reserved_requests - 1, 0), updated_at = now()
    where company_id = p_company_id and usage_day = (p_now at time zone 'UTC')::date;
  end if;

  -- Circuit breaker -----------------------------------------------------
  select * into c from ai_provider_circuit_state where scope = p_scope for update;
  if not found then
    insert into ai_provider_circuit_state (scope) values (p_scope) on conflict (scope) do nothing;
    select * into c from ai_provider_circuit_state where scope = p_scope for update;
  end if;

  if p_circuit_signal = 'success' then
    update ai_provider_circuit_state
    set state = 'closed', consecutive_timeouts = 0, consecutive_provider_failures = 0, opened_at = null, open_reason = null,
        next_probe_at = null, probe_backoff_seconds = 3600, probe_in_flight_until = null, updated_at = now()
    where scope = p_scope;
  elsif p_circuit_signal in ('auth', 'timeout', 'provider_failure', 'rate_limit') then
    if c.state = 'open' then
      if p_probe then
        v_backoff := least(c.probe_backoff_seconds * 2, 86400);
        update ai_provider_circuit_state
        set probe_backoff_seconds = v_backoff, next_probe_at = p_now + make_interval(secs => v_backoff), probe_in_flight_until = null,
            last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message, updated_at = now()
        where scope = p_scope;
      else
        update ai_provider_circuit_state
        set last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message, updated_at = now()
        where scope = p_scope;
      end if;
    elsif p_circuit_signal = 'auth'
       or (p_circuit_signal = 'timeout' and c.consecutive_timeouts + 1 >= 3)
       or (p_circuit_signal = 'provider_failure' and c.consecutive_provider_failures + 1 >= 5) then
      update ai_provider_circuit_state
      set state = 'open', opened_at = p_now, open_reason = coalesce(p_error_category, p_circuit_signal),
          consecutive_timeouts = case when p_circuit_signal = 'timeout' then c.consecutive_timeouts + 1 else c.consecutive_timeouts end,
          consecutive_provider_failures = case when p_circuit_signal = 'provider_failure' then c.consecutive_provider_failures + 1 else c.consecutive_provider_failures end,
          probe_backoff_seconds = 3600, next_probe_at = p_now + interval '1 hour', probe_in_flight_until = null,
          last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message, updated_at = now()
      where scope = p_scope;
    else
      update ai_provider_circuit_state
      set consecutive_timeouts = case when p_circuit_signal = 'timeout' then c.consecutive_timeouts + 1 else c.consecutive_timeouts end,
          consecutive_provider_failures = case when p_circuit_signal = 'provider_failure' then c.consecutive_provider_failures + 1 else c.consecutive_provider_failures end,
          last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message, updated_at = now()
      where scope = p_scope;
    end if;
  elsif p_probe and c.state = 'open' then
    -- The probe never reached the provider (e.g. evidence read failed):
    -- release the claim so the next request can probe.
    update ai_provider_circuit_state set probe_in_flight_until = null, updated_at = now() where scope = p_scope;
  end if;

  select * into c from ai_provider_circuit_state where scope = p_scope;
  return jsonb_build_object('queue_state', v_state, 'next_eligible_at', v_next, 'circuit_state', c.state,
    'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Sweep candidates: the same eligibility as
--    listAiClassificationEligibleTransactions (transaction-explorer-
--    repository.ts) and fn_apply_ai_classification, minus transactions in
--    cooldown, awaiting human review, or already resolved once. Order:
--    never attempted, then least recently attempted, then oldest
--    transaction date.
-- ---------------------------------------------------------------------
create or replace function fn_ai_classification_candidates(p_company_id uuid, p_limit integer, p_now timestamptz default now())
returns table (transaction_id bigint, never_attempted boolean, last_attempt_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, q.transaction_id is null, q.last_attempt_at
  from ae_bank_transactions b
  left join ai_classification_queue_state q on q.transaction_id = b.id
  where b.company_id = p_company_id
    and b.allocation_status = 'Unallocated'
    and b.suggested_gl_account is null
    and b.rule_id is null
    and b.matched_supplier_id is null
    and b.matched_customer_id is null
    and b.matched_merchant_id is null
    and b.journal_id is null
    and b.is_manual_override = false
    and b.review_hold = false
    and b.review_status is null
    and b.required_action is null
    and (q.transaction_id is null
         or (q.state not in ('needs_human_review', 'resolved') and (q.next_eligible_at is null or q.next_eligible_at <= p_now)))
  order by (q.last_attempt_at is not null), q.last_attempt_at asc nulls first, b.transaction_date asc nulls last, b.id asc
  limit greatest(p_limit, 0);
$$;

-- ---------------------------------------------------------------------
-- 9. Explicit "Retry AI": puts one transaction back into the sweep's
--    queue (never called automatically).
-- ---------------------------------------------------------------------
create or replace function fn_ai_classification_reset_queue_state(p_company_id uuid, p_transaction_id bigint)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with r as (
    update ai_classification_queue_state
    set state = 'active', unusable_result_count = 0, next_eligible_at = null, updated_at = now()
    where company_id = p_company_id and transaction_id = p_transaction_id
    returning 1
  )
  select exists (select 1 from r);
$$;

-- Read-only view of the circuit for run summaries and the dashboard.
create or replace function fn_ai_provider_circuit_status(p_scope text default 'transaction-classification')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('scope', scope, 'state', state, 'open_reason', open_reason, 'opened_at', opened_at,
    'next_probe_at', next_probe_at, 'probe_backoff_seconds', probe_backoff_seconds, 'probe_in_flight_until', probe_in_flight_until,
    'consecutive_timeouts', consecutive_timeouts, 'consecutive_provider_failures', consecutive_provider_failures,
    'last_error_category', last_error_category, 'last_http_status', last_http_status)
  from ai_provider_circuit_state where scope = p_scope;
$$;

revoke execute on function fn_record_internal_usage_event(uuid, text, numeric, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function fn_ai_classification_gate(uuid, bigint, text, timestamptz, integer, text) from public, anon, authenticated;
revoke execute on function fn_ai_classification_record_attempt(uuid, bigint, bigint, text, text, boolean, text, text, integer, text, jsonb, integer, text, text, timestamptz, text, boolean) from public, anon, authenticated;
revoke execute on function fn_ai_classification_candidates(uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function fn_ai_classification_reset_queue_state(uuid, bigint) from public, anon, authenticated;
revoke execute on function fn_ai_provider_circuit_status(text) from public, anon, authenticated;
grant execute on function fn_record_internal_usage_event(uuid, text, numeric, jsonb, timestamptz) to service_role;
grant execute on function fn_ai_classification_gate(uuid, bigint, text, timestamptz, integer, text) to service_role;
grant execute on function fn_ai_classification_record_attempt(uuid, bigint, bigint, text, text, boolean, text, text, integer, text, jsonb, integer, text, text, timestamptz, text, boolean) to service_role;
grant execute on function fn_ai_classification_candidates(uuid, integer, timestamptz) to service_role;
grant execute on function fn_ai_classification_reset_queue_state(uuid, bigint) to service_role;
grant execute on function fn_ai_provider_circuit_status(text) to service_role;

-- ---------------------------------------------------------------------
-- 10. Suspended automation tasks: exhausted scheduler retries stop the
--     task (listDueTasks only selects active Queued/Success/Failed tasks)
--     until a person resumes it.
-- ---------------------------------------------------------------------
alter table automation_tasks drop constraint if exists automation_tasks_status_check;
alter table automation_tasks add constraint automation_tasks_status_check
  check (status in ('Queued', 'Running', 'Success', 'Failed', 'Paused', 'Disabled', 'Suspended'));
alter table automation_tasks add column if not exists suspended_reason text;
alter table automation_tasks add column if not exists suspended_at timestamptz;

-- ---------------------------------------------------------------------
-- 11. De-duplicated operations alerts: while an alert with the same
--     dedupe_key is not Resolved, a repeat updates it instead of adding a
--     new row. Security invoker: the existing operations_alerts RLS
--     (own company only) applies to company users.
-- ---------------------------------------------------------------------
alter table operations_alerts add column if not exists dedupe_key text;
alter table operations_alerts add column if not exists occurrence_count integer not null default 1;
alter table operations_alerts add column if not exists last_occurred_at timestamptz;
create unique index if not exists operations_alerts_active_dedupe_idx
  on operations_alerts (company_id, dedupe_key) where dedupe_key is not null and status <> 'Resolved';

create or replace function fn_raise_deduplicated_alert(
  p_company_id uuid, p_dedupe_key text, p_source_engine text, p_severity text, p_title text, p_message text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_created boolean;
  v_count integer;
begin
  insert into operations_alerts (company_id, source_engine, severity, title, message, dedupe_key, occurrence_count, last_occurred_at, created_by)
  values (p_company_id, p_source_engine, p_severity, p_title, coalesce(p_message, ''), p_dedupe_key, 1, p_now, 'System')
  on conflict (company_id, dedupe_key) where dedupe_key is not null and status <> 'Resolved'
  do update set occurrence_count = operations_alerts.occurrence_count + 1, last_occurred_at = excluded.last_occurred_at,
                message = excluded.message, severity = excluded.severity
  returning id, (xmax = 0), occurrence_count into v_id, v_created, v_count;
  return jsonb_build_object('alert_id', v_id, 'created', v_created, 'occurrence_count', v_count);
end;
$$;

create or replace function fn_resolve_deduplicated_alert(p_company_id uuid, p_dedupe_key text, p_resolved_by text, p_now timestamptz default now())
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  with r as (
    update operations_alerts
    set status = 'Resolved', resolved_by = p_resolved_by, resolved_at = p_now
    where company_id = p_company_id and dedupe_key = p_dedupe_key and status <> 'Resolved'
    returning 1
  )
  select count(*)::integer from r;
$$;

revoke execute on function fn_raise_deduplicated_alert(uuid, text, text, text, text, text, timestamptz) from public, anon;
revoke execute on function fn_resolve_deduplicated_alert(uuid, text, text, timestamptz) from public, anon;
grant execute on function fn_raise_deduplicated_alert(uuid, text, text, text, text, text, timestamptz) to authenticated, service_role;
grant execute on function fn_resolve_deduplicated_alert(uuid, text, text, timestamptz) to authenticated, service_role;
