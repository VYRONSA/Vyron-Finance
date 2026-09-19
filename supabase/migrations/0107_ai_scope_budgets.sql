-- Phase 5L, Decision 1 — scope-specific AI usage budgets.
--
-- THE PROBLEM. `ai_provider_daily_usage` is keyed (company_id, usage_day)
-- and `fn_ai_classification_gate` clamps the cap to 100. That is one
-- provider-wide allowance for the whole company. Supplier Invoice Capture
-- costs 1 provider request per document (more if deterministic validation
-- rejects an attempt), so putting it on the same counter would let invoice
-- capture starve transaction classification, or the reverse — two
-- unrelated features competing for one fuse.
--
-- THE SHAPE. Two layers, both kept, per the approved decision:
--
--   scope budget      operational limit, per company per scope per day.
--                     'transaction-classification' stays at 100, so today's
--                     behaviour is reproduced exactly, not merely
--                     approximated.
--   provider fuse     emergency protection, per company per day across
--                     every scope. Deliberately set well above the sum of
--                     the scope budgets: it is a runaway stop, not the
--                     operational limit. It is NOT removed — the approved
--                     decision is "provider/global emergency protection PLUS
--                     scope-specific usage protection", not one replacing
--                     the other.
--
-- A request must reserve BOTH. If either is exhausted the request is
-- refused and any reservation already taken is given back, so the two
-- counters can never drift apart.
--
-- NOT COMMERCIAL. This is operational protection. It is not metering, not
-- billing, and not a customer quota. No pricing, plan or product changes.
-- The customer-facing metering path (`fn_record_usage_event`) is untouched.
--
-- BEHAVIOUR PRESERVED. `fn_ai_classification_gate` keeps its exact
-- signature, its decision vocabulary and its <=100 clamp. Its reservation
-- step now delegates to the shared helper. The existing regression suite
-- `supabase/tests/ai_classification_safety.test.sql` must pass unchanged.

-- ---------------------------------------------------------------------
-- 1. Budgets. Defaults per scope, with an optional per-company override —
--    "configurable" without inventing a settings UI or a billing concept.
-- ---------------------------------------------------------------------
create table if not exists ai_provider_scope_budgets (
  scope text primary key,
  daily_request_cap integer not null check (daily_request_cap >= 0),
  description text not null default '',
  updated_at timestamptz not null default now()
);

alter table ai_provider_scope_budgets enable row level security;
revoke all on table ai_provider_scope_budgets from public, anon, authenticated, service_role;

create table if not exists ai_provider_company_budget_overrides (
  company_id uuid not null references companies (id) on delete cascade,
  scope text not null,
  daily_request_cap integer not null check (daily_request_cap >= 0),
  reason text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, scope)
);

alter table ai_provider_company_budget_overrides enable row level security;
revoke all on table ai_provider_company_budget_overrides from public, anon, authenticated, service_role;

-- `__provider__` is the emergency fuse's reserved scope name. It is not a
-- feature scope and nothing extracts or classifies under it.
insert into ai_provider_scope_budgets (scope, daily_request_cap, description) values
  ('transaction-classification', 100, 'Bank transaction classification sweep. Unchanged from migration 0099.'),
  ('supplier-invoice-extraction', 200, 'VYRON AI Supplier Invoice Capture. One request per document, plus bounded revalidation retries.'),
  ('__provider__', 500, 'Emergency provider-wide fuse across every scope for one company. Not an operational limit.')
on conflict (scope) do nothing;

-- ---------------------------------------------------------------------
-- 2. The counter gains a scope.
--
--    Existing rows are backfilled to 'transaction-classification' because
--    that is the only scope that has ever written to this table — the
--    counts stay attached to the feature that actually made the requests.
--    A provider-fuse row is then derived from them, so today's usage is
--    represented in both layers rather than the fuse starting at zero
--    while requests have already been made.
-- ---------------------------------------------------------------------
alter table ai_provider_daily_usage
  add column if not exists scope text not null default 'transaction-classification';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_daily_usage_pkey'
      and conrelid = 'ai_provider_daily_usage'::regclass
      and array_length(conkey, 1) = 2
  ) then
    -- Derive the emergency-fuse rows from what has already been used,
    -- BEFORE the key widens, so the sum is taken over scoped rows only.
    insert into ai_provider_daily_usage (company_id, usage_day, scope, reserved_requests)
    select company_id, usage_day, '__provider__', sum(reserved_requests)
    from ai_provider_daily_usage
    where scope <> '__provider__'
    group by company_id, usage_day
    on conflict do nothing;

    alter table ai_provider_daily_usage drop constraint ai_provider_daily_usage_pkey;
    alter table ai_provider_daily_usage add primary key (company_id, scope, usage_day);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Budget resolution: company override, else scope default, else 0.
--    A scope with no budget row reserves nothing — an unknown scope is
--    refused rather than silently granted an allowance.
-- ---------------------------------------------------------------------
create or replace function fn_ai_resolve_daily_cap(p_company_id uuid, p_scope text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select daily_request_cap from ai_provider_company_budget_overrides
      where company_id = p_company_id and scope = p_scope),
    (select daily_request_cap from ai_provider_scope_budgets where scope = p_scope),
    0
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Atomic two-layer reservation.
--
--    Each UPDATE re-checks its own count under the row lock it takes, so
--    concurrent callers can never reserve more than a cap between them —
--    the same technique 0099 used, applied twice. If the second layer is
--    exhausted the first is given back in the same transaction, so a
--    refusal never consumes budget.
--
--    Returns jsonb: {reserved, refused_layer, scope_used, scope_cap,
--                    provider_used, provider_cap}
-- ---------------------------------------------------------------------
create or replace function fn_ai_reserve_request(
  p_company_id uuid,
  p_scope text,
  p_now timestamptz default now(),
  p_scope_cap_override integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (p_now at time zone 'UTC')::date;
  v_scope_cap integer := fn_ai_resolve_daily_cap(p_company_id, p_scope);
  v_provider_cap integer := fn_ai_resolve_daily_cap(p_company_id, '__provider__');
  v_scope_reserved integer;
  v_provider_reserved integer;
begin
  if p_scope = '__provider__' then
    raise exception 'fn_ai_reserve_request: "__provider__" is the emergency fuse, not a callable scope';
  end if;

  -- A caller may ask for a LOWER cap than the budget, never a higher one —
  -- the same direction of trust 0099 established for p_daily_cap.
  if p_scope_cap_override is not null then
    v_scope_cap := least(v_scope_cap, greatest(p_scope_cap_override, 0));
  end if;

  insert into ai_provider_daily_usage (company_id, scope, usage_day)
  values (p_company_id, p_scope, v_day) on conflict do nothing;
  update ai_provider_daily_usage
  set reserved_requests = reserved_requests + 1, updated_at = now()
  where company_id = p_company_id and scope = p_scope and usage_day = v_day
    and reserved_requests < v_scope_cap
  returning reserved_requests into v_scope_reserved;

  if v_scope_reserved is null then
    return jsonb_build_object('reserved', false, 'refused_layer', 'scope',
      'scope_used', coalesce((select reserved_requests from ai_provider_daily_usage
        where company_id = p_company_id and scope = p_scope and usage_day = v_day), 0),
      'scope_cap', v_scope_cap, 'provider_cap', v_provider_cap);
  end if;

  insert into ai_provider_daily_usage (company_id, scope, usage_day)
  values (p_company_id, '__provider__', v_day) on conflict do nothing;
  update ai_provider_daily_usage
  set reserved_requests = reserved_requests + 1, updated_at = now()
  where company_id = p_company_id and scope = '__provider__' and usage_day = v_day
    and reserved_requests < v_provider_cap
  returning reserved_requests into v_provider_reserved;

  if v_provider_reserved is null then
    -- Emergency fuse blown: hand the scope reservation back so the two
    -- counters stay consistent with each other.
    update ai_provider_daily_usage
    set reserved_requests = greatest(reserved_requests - 1, 0), updated_at = now()
    where company_id = p_company_id and scope = p_scope and usage_day = v_day;
    return jsonb_build_object('reserved', false, 'refused_layer', 'provider',
      'scope_used', v_scope_reserved - 1, 'scope_cap', v_scope_cap,
      'provider_used', coalesce((select reserved_requests from ai_provider_daily_usage
        where company_id = p_company_id and scope = '__provider__' and usage_day = v_day), 0),
      'provider_cap', v_provider_cap);
  end if;

  return jsonb_build_object('reserved', true, 'refused_layer', null,
    'scope_used', v_scope_reserved - 1, 'scope_cap', v_scope_cap,
    'provider_used', v_provider_reserved - 1, 'provider_cap', v_provider_cap);
end;
$$;

-- Releases a reservation that never reached the provider. Both layers,
-- always together.
create or replace function fn_ai_release_request(
  p_company_id uuid,
  p_scope text,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (p_now at time zone 'UTC')::date;
begin
  update ai_provider_daily_usage
  set reserved_requests = greatest(reserved_requests - 1, 0), updated_at = now()
  where company_id = p_company_id and usage_day = v_day and scope in (p_scope, '__provider__');
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The classification gate delegates its reservation step.
--
--    Signature, decision vocabulary and the <=100 clamp are unchanged.
--    Everything before and after the reservation is byte-identical to
--    0099; only the two reservation/give-back blocks now call the shared
--    helper so classification and invoice capture cannot drift apart.
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
  v_cap integer := least(greatest(coalesce(p_daily_cap, 100), 0), 100);
  v_day date := (p_now at time zone 'UTC')::date;
  v_company uuid;
  q ai_classification_queue_state%rowtype;
  c ai_provider_circuit_state%rowtype;
  v_reservation jsonb;
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

  if p_source <> 'manual' then
    select * into q from ai_classification_queue_state where transaction_id = p_transaction_id;
    if found and (q.state in ('needs_human_review', 'resolved') or (q.next_eligible_at is not null and q.next_eligible_at > p_now)) then
      return jsonb_build_object('decision', 'held', 'queue_state', q.state, 'next_eligible_at', q.next_eligible_at,
        'circuit_state', null, 'open_reason', null, 'next_probe_at', null, 'requests_today', null, 'daily_cap', v_cap);
    end if;
  end if;

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

  v_reservation := fn_ai_reserve_request(p_company_id, p_scope, p_now, v_cap);
  if not (v_reservation ->> 'reserved')::boolean then
    return jsonb_build_object('decision', 'daily_cap', 'queue_state', null, 'next_eligible_at', null,
      'circuit_state', c.state, 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at,
      'requests_today', (v_reservation ->> 'scope_used')::integer,
      'daily_cap', v_cap, 'refused_layer', v_reservation ->> 'refused_layer');
  end if;
  v_reserved := (v_reservation ->> 'scope_used')::integer;

  if v_probe then
    update ai_provider_circuit_state
    set probe_in_flight_until = p_now + interval '10 minutes', updated_at = now()
    where scope = p_scope and state = 'open' and next_probe_at is not null and next_probe_at <= p_now
      and (probe_in_flight_until is null or probe_in_flight_until <= p_now)
    returning scope into v_claimed;
    if v_claimed is null then
      select * into c from ai_provider_circuit_state where scope = p_scope;
      if c.state = 'open' then
        perform fn_ai_release_request(p_company_id, p_scope, p_now);
        return jsonb_build_object('decision', 'circuit_open', 'queue_state', null, 'next_eligible_at', null,
          'circuit_state', 'open', 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at,
          'requests_today', null, 'daily_cap', v_cap);
      end if;
      v_probe := false;
    end if;
  end if;

  return jsonb_build_object('decision', case when v_probe then 'probe' else 'allow' end, 'queue_state', null, 'next_eligible_at', null,
    'circuit_state', case when v_probe then 'open' else 'closed' end, 'open_reason', case when v_probe then c.open_reason end,
    'next_probe_at', case when v_probe then c.next_probe_at end, 'requests_today', v_reserved, 'daily_cap', v_cap);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The attempt recorder's give-back becomes scope-aware.
--
--    0099 released with `where company_id = ... and usage_day = ...` and no
--    scope predicate. Once the table is scoped that statement would
--    decrement EVERY scope's counter for that company, including the
--    emergency fuse and any unrelated feature. Replaced with the shared
--    release, which decrements exactly the scope and the fuse.
-- ---------------------------------------------------------------------
create or replace function fn_ai_classification_release_reservation(
  p_company_id uuid,
  p_scope text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform fn_ai_release_request(p_company_id, p_scope, p_now);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. The new feature's circuit scope. One row, no schema change — the
--    circuit table has been keyed by `scope` since 0099.
-- ---------------------------------------------------------------------
insert into ai_provider_circuit_state (scope) values ('supplier-invoice-extraction')
on conflict (scope) do nothing;

comment on table ai_provider_scope_budgets is
  'Phase 5L — operational per-scope daily request budgets. Not metering, not billing, not a customer quota.';
comment on table ai_provider_company_budget_overrides is
  'Phase 5L — per-company override of a scope budget. Operational protection only.';

-- ---------------------------------------------------------------------
-- 6b. `fn_ai_classification_record_attempt`, reproduced verbatim from
--     0099 with exactly ONE change: the give-back is now scope-aware (see
--     the comment inside). The body was extracted from 0099 programmatically
--     rather than retyped, so no other line can have drifted.
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
    -- Phase 5L — scope-aware. Before the counter was scoped this was an
    -- unqualified UPDATE over (company_id, usage_day); left as it was it
    -- would now decrement EVERY scope's counter for this company, plus the
    -- emergency fuse, on any attempt that never reached the provider.
    perform fn_ai_release_request(p_company_id, p_scope, p_now);
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
