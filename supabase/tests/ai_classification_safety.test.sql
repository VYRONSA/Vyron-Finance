-- Database tests for migration 0099 (AI classification safety).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end, so nothing is left behind. Never run against a
-- shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ai_classification_safety.test.sql
--
-- Each check prints "PASS: ..." as a NOTICE; the first failure aborts the
-- run with "FAIL: ...". Letters refer to the approved test list (A–Y).
-- True multi-connection concurrency (the fuse and the probe under parallel
-- callers) is exercised end to end in
-- src/server/services/ai-classification-safety.scenario.test.ts.

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

-- ---------------------------------------------------------------------
-- Helpers (session-temporary).
-- ---------------------------------------------------------------------
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end $$;

create function pg_temp.co_a() returns uuid language sql immutable as $$ select '0a100000-0000-4000-8000-00000000ca00'::uuid $$;
create function pg_temp.co_b() returns uuid language sql immutable as $$ select '0a100000-0000-4000-8000-00000000cb00'::uuid $$;

create function pg_temp.tx(p_company uuid, p_date date, p_desc text) returns bigint language sql as $$
  insert into ae_bank_transactions (company_id, transaction_date, description, debit, credit)
  values (p_company, p_date, p_desc, 10, 0) returning id
$$;

create function pg_temp.rec(p_company uuid, p_tx bigint, p_outcome text, p_request boolean, p_signal text, p_now timestamptz,
                            p_category text default null, p_http integer default null, p_message text default null,
                            p_probe boolean default false)
returns jsonb language sql as $$
  select fn_ai_classification_record_attempt(p_company, p_tx, null, 'sweep', p_outcome, p_request, 'openai/gpt-4o-mini',
    p_category, p_http, p_message, null, 5, 'VYRON AI', p_signal, p_now, 'transaction-classification', p_probe)
$$;

-- Defaults to the explicit (manual) path and the company's first transaction,
-- so circuit/cap checks are not affected by queue holds.
create function pg_temp.gate(p_company uuid, p_now timestamptz, p_tx bigint default null, p_source text default 'manual', p_cap integer default 100)
returns jsonb language sql as $$
  select fn_ai_classification_gate(p_company,
    coalesce(p_tx, (select min(id) from ae_bank_transactions where company_id = p_company)),
    p_source, p_now, p_cap, 'transaction-classification')
$$;

create function pg_temp.reserved(p_company uuid, p_day date) returns integer language sql as $$
  select coalesce((select reserved_requests from ai_provider_daily_usage where company_id = p_company and usage_day = p_day), 0)
$$;

create function pg_temp.cands(p_company uuid, p_now timestamptz, p_limit integer default 20) returns bigint[] language sql as $$
  select coalesce(array_agg(c.transaction_id order by c.ord), '{}')
  from fn_ai_classification_candidates(p_company, p_limit, p_now) with ordinality as c(transaction_id, never_attempted, last_attempt_at, ord)
$$;

create function pg_temp.circuit() returns ai_provider_circuit_state language sql as $$
  select * from ai_provider_circuit_state where scope = 'transaction-classification'
$$;

create function pg_temp.reset_circuit() returns void language sql as $$
  update ai_provider_circuit_state
  set state = 'closed', consecutive_timeouts = 0, consecutive_provider_failures = 0, opened_at = null, open_reason = null,
      last_error_category = null, last_http_status = null, last_error_message = null, next_probe_at = null,
      probe_backoff_seconds = 3600, probe_in_flight_until = null
  where scope = 'transaction-classification'
$$;

create function pg_temp.clear(p_company uuid) returns void language sql as $$
  delete from ae_bank_transactions where company_id = p_company
$$;

create function pg_temp.requests(p_company uuid, p_from timestamptz, p_to timestamptz) returns integer language sql as $$
  select count(*)::integer from ai_classification_attempts
  where company_id = p_company and provider_request_made and attempted_at >= p_from and attempted_at < p_to
$$;

-- ---------------------------------------------------------------------
-- Synthetic fixture: two companies with one owner each.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('0a100000-0000-4000-8000-00000000a001', 'ai-safety-owner-a@synthetic.test', 'authenticated', 'authenticated'),
  ('0a100000-0000-4000-8000-00000000b001', 'ai-safety-owner-b@synthetic.test', 'authenticated', 'authenticated');
insert into organisations (id, name) values
  ('0a100000-0000-4000-8000-0000000a0000', 'Synthetic Org A'),
  ('0a100000-0000-4000-8000-0000000b0000', 'Synthetic Org B');
insert into companies (id, organisation_id, name) values
  (pg_temp.co_a(), '0a100000-0000-4000-8000-0000000a0000', 'Synthetic Northwood'),
  (pg_temp.co_b(), '0a100000-0000-4000-8000-0000000b0000', 'Synthetic Metanoia');
select seed_company_rbac_defaults(pg_temp.co_a());
select seed_company_rbac_defaults(pg_temp.co_b());
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select '0a100000-0000-4000-8000-00000000a001', company_id, id, 'ai-safety-test' from permission_roles where company_id = pg_temp.co_a() and role_key = 'company_owner';
insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
select '0a100000-0000-4000-8000-00000000b001', company_id, id, 'ai-safety-test' from permission_roles where company_id = pg_temp.co_b() and role_key = 'company_owner';

select pg_temp.ok((select state from ai_provider_circuit_state where scope = 'transaction-classification') is not null, 'the shared circuit row is seeded by the migration');

-- ---------------------------------------------------------------------
-- 1. Queue transitions (A–F, explicit Retry AI) and queue holds at the gate.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  t bigint;
  r jsonb;
  t0 timestamptz := '2030-01-15 10:00:00+00';
begin
  perform pg_temp.reset_circuit();
  t := pg_temp.tx(a, '2025-01-01', 'SYN queue');

  perform pg_temp.ok(pg_temp.gate(a, t0, t, 'sweep')->>'decision' = 'allow', 'A. first attempt: the gate allows (and reserves) one provider request');
  r := pg_temp.rec(a, t, 'no_confidence', true, 'success', t0);
  perform pg_temp.ok((select count(*) from ai_classification_attempts where transaction_id = t) = 1 and pg_temp.reserved(a, '2030-01-15') = 1,
    'A. exactly one attempt is recorded and one request reserved');

  perform pg_temp.ok(r->>'queue_state' = 'cooldown' and (r->>'next_eligible_at')::timestamptz = t0 + interval '7 days', 'B. no confidence -> 7-day cooldown');
  perform pg_temp.ok(not (t = any (pg_temp.cands(a, t0 + interval '2 minutes'))), 'C. not selected by the sweep 2 minutes later');
  perform pg_temp.ok(not (t = any (pg_temp.cands(a, t0 + interval '6 days 23 hours'))), 'C. not selected at any point during the cooldown');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '2 minutes', t, 'sweep')->>'decision' = 'held', 'C. the gate itself holds it for the sweep');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '2 minutes', t, 'import')->>'decision' = 'held', 'C. ... and for the post-import path (no bypass)');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '2 minutes', t, 'manual')->>'decision' = 'allow', 'C. an explicit "Classify with AI" (manual) is the only way to re-ask during a cooldown');
  perform pg_temp.ok(t = any (pg_temp.cands(a, t0 + interval '7 days')), 'D. eligible again when the cooldown ends');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '7 days', t, 'sweep')->>'decision' = 'allow', 'D. ... and the gate allows it');

  r := pg_temp.rec(a, t, 'no_confidence', true, 'success', t0 + interval '7 days');
  perform pg_temp.ok(r->>'queue_state' = 'needs_human_review' and r->>'next_eligible_at' is null, 'E. second no confidence -> needs human review');
  perform pg_temp.ok(not (t = any (pg_temp.cands(a, t0 + interval '3650 days', 1000))), 'F. needs human review is never selected by the sweep (checked 10 years later)');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '3650 days', t, 'sweep')->>'decision' = 'held'
    and pg_temp.gate(a, t0 + interval '3650 days', t, 'import')->>'decision' = 'held', 'F. ... and the gate holds it for every automatic path');

  r := pg_temp.rec(a, t, 'provider_error', true, 'none', t0 + interval '8 days', 'server-error', 503, 'Service Unavailable');
  perform pg_temp.ok(r->>'queue_state' = 'needs_human_review', 'F. a later provider error never releases a human-review hold');
  r := pg_temp.rec(a, t, 'evidence_error', false, 'none', t0 + interval '8 days');
  perform pg_temp.ok(r->>'queue_state' = 'needs_human_review', 'F. nor does a database/evidence error');

  perform pg_temp.ok(not fn_ai_classification_reset_queue_state(pg_temp.co_b(), t), 'Retry AI: another company cannot reset this transaction');
  perform pg_temp.ok(fn_ai_classification_reset_queue_state(a, t), 'Retry AI: the explicit reset succeeds');
  perform pg_temp.ok(t = any (pg_temp.cands(a, t0 + interval '8 days')), 'Retry AI: the transaction re-enters the queue only through that explicit action');

  r := pg_temp.rec(a, t, 'suggested', true, 'success', t0 + interval '8 days');
  perform pg_temp.ok(r->>'queue_state' = 'resolved', 'a saved suggestion resolves the queue entry');
  perform pg_temp.ok(not (t = any (pg_temp.cands(a, t0 + interval '400 days', 1000))) and pg_temp.gate(a, t0 + interval '400 days', t, 'sweep')->>'decision' = 'held',
    'a resolved transaction is never re-asked automatically, even if its suggestion is later removed');
  perform pg_temp.ok((select attempt_count from ai_classification_queue_state where transaction_id = t) = 5, 'attempt_count counts every attempt');
end $$;

-- ---------------------------------------------------------------------
-- 2. Other outcomes, usage counting (T–W), validation.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  t_evidence bigint;
  t_write bigint;
  t_provider bigint;
  t_invalid bigint;
  r jsonb;
  t0 timestamptz := '2030-01-20 10:00:00+00';
  v_failed boolean;
begin
  perform pg_temp.reset_circuit();
  t_evidence := pg_temp.tx(a, '2025-02-01', 'SYN evidence');
  t_write := pg_temp.tx(a, '2025-02-02', 'SYN write');
  t_provider := pg_temp.tx(a, '2025-02-03', 'SYN provider');
  t_invalid := pg_temp.tx(a, '2025-02-04', 'SYN invalid');

  perform pg_temp.gate(a, t0, t_evidence, 'sweep');
  perform pg_temp.ok(pg_temp.reserved(a, '2030-01-20') = 1, 'the gate reserved one request before the evidence was built');
  r := pg_temp.rec(a, t_evidence, 'evidence_error', false, 'none', t0);
  perform pg_temp.ok(r->>'queue_state' = 'cooldown' and (r->>'next_eligible_at')::timestamptz = t0 + interval '1 day', 'a database/evidence failure is retried after a day, not every pass');
  perform pg_temp.ok((select count(*) from usage_events where company_id = a and metric_key = 'ai_provider_requests' and occurred_at = t0) = 0, 'W. a failure BEFORE the provider call is NOT counted as a provider request');
  perform pg_temp.ok(pg_temp.reserved(a, '2030-01-20') = 0, 'W. ... and its reservation is given back (not counted toward the daily fuse)');
  perform pg_temp.ok((pg_temp.circuit()).state = 'closed' and (pg_temp.circuit()).consecutive_provider_failures = 0, 'W. ... and never moves the circuit breaker');

  perform pg_temp.gate(a, t0, t_write, 'sweep');
  r := pg_temp.rec(a, t_write, 'write_error', true, 'success', t0);
  perform pg_temp.ok(r->>'queue_state' = 'cooldown', 'a lost write race -> short cooldown');
  perform pg_temp.ok((select count(*) from usage_events where company_id = a and metric_key = 'ai_provider_requests' and occurred_at = t0) = 1
    and pg_temp.reserved(a, '2030-01-20') = 1, 'a write error after a real answer IS a provider request, counted once');
  r := pg_temp.rec(a, t_write, 'write_error', true, 'success', t0 + interval '2 days');
  perform pg_temp.ok(r->>'queue_state' = 'needs_human_review', 'a second unusable answer (write failure) -> human review: never re-requested daily forever');

  r := pg_temp.rec(a, t_provider, 'provider_error', true, 'provider_failure', t0, 'server-error', 503, 'Service Unavailable');
  perform pg_temp.ok(r->>'queue_state' = 'active' and r->>'next_eligible_at' is null, 'a provider outage is not the transaction''s fault: it stays eligible');
  perform pg_temp.ok((select count(*) from usage_events where company_id = a and metric_key = 'ai_provider_requests' and occurred_at = t0) = 2, 'V. a provider failure AFTER the request IS a provider request');
  perform pg_temp.ok(t_provider = any (pg_temp.cands(a, t0 + interval '1 minute')), 'the transaction stays queued for when the provider recovers');

  r := pg_temp.rec(a, t_invalid, 'invalid_response', true, 'success', t0, 'malformed-response');
  perform pg_temp.ok(r->>'queue_state' = 'cooldown', 'an invalid/malformed answer is treated like no confidence (cooldown)');
  perform pg_temp.ok((select count(*) from usage_events where company_id = a and metric_key = 'ai_provider_requests' and occurred_at = t0) = 3, 'malformed/validation failures ARE provider requests');
  perform pg_temp.ok((select metadata->>'outcome' from usage_events where company_id = a and metric_key = 'ai_provider_requests' and occurred_at = t0 order by id desc limit 1) = 'invalid_response', 'the usage event records the attempt outcome');

  perform pg_temp.rec(a, t_provider, 'provider_error', true, 'none', t0, 'server-error', 500, repeat('overloaded ', 100));
  perform pg_temp.ok((select max(char_length(provider_message)) from ai_classification_attempts where transaction_id = t_provider) = 300, 'X. the stored provider message is capped at 300 characters by the database too');

  v_failed := false;
  begin
    perform pg_temp.rec(pg_temp.co_b(), t_evidence, 'no_confidence', true, 'success', t0);
  exception when others then
    v_failed := sqlerrm like '%does not belong to company%';
  end;
  perform pg_temp.ok(v_failed, 'an attempt can only be recorded against the transaction''s own company');

  v_failed := false;
  begin
    perform fn_ai_classification_gate(pg_temp.co_b(), t_evidence, 'manual', t0, 100, 'transaction-classification');
  exception when others then
    v_failed := sqlerrm like '%does not belong to company%';
  end;
  perform pg_temp.ok(v_failed, 'the gate refuses a transaction from another company');

  v_failed := false;
  begin
    perform fn_ai_classification_gate(a, t_evidence, 'cron', t0, 100, 'transaction-classification');
  exception when others then
    v_failed := sqlerrm like '%unknown source%';
  end;
  perform pg_temp.ok(v_failed, 'the gate refuses an unknown source');

  v_failed := false;
  begin
    perform pg_temp.rec(a, t_evidence, 'no_confidence', true, 'bogus', t0);
  exception when others then
    v_failed := sqlerrm like '%unknown circuit signal%';
  end;
  perform pg_temp.ok(v_failed, 'an unknown circuit signal is rejected');

  v_failed := false;
  begin
    perform pg_temp.rec(a, t_evidence, 'posted', true, 'success', t0);
  exception when check_violation then
    v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'only the defined attempt outcomes can be stored');
end $$;

-- ---------------------------------------------------------------------
-- 3. Shared provider circuit breaker (G, I, J, K, backoff, probe rules).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  b uuid := pg_temp.co_b();
  t bigint;
  tb bigint;
  c ai_provider_circuit_state;
  t0 timestamptz := '2030-03-01 10:00:00+00';
  v_t timestamptz;
  v_expected integer;
  v_all_ok boolean := true;
  v_status integer;
  v_reserved_before integer;
  i integer;
begin
  perform pg_temp.reset_circuit();
  t := pg_temp.tx(a, '2025-03-01', 'SYN circuit');
  tb := pg_temp.tx(b, '2025-03-01', 'SYN circuit B');

  perform pg_temp.rec(a, t, 'provider_error', true, 'auth', t0, 'unauthorized', 401, 'Unauthorized');
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'open' and c.open_reason = 'unauthorized' and c.last_http_status = 401 and c.next_probe_at = t0 + interval '1 hour',
    'G. a 401 opens the circuit immediately; first probe in 1 hour');

  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '1 second', t)->>'decision' = 'circuit_open', 'J. circuit open -> no provider request allowed');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '59 minutes', t)->>'decision' = 'circuit_open', 'J. ... right up to the probe time');
  perform pg_temp.ok(pg_temp.gate(b, t0 + interval '30 minutes', tb)->>'decision' = 'circuit_open', 'J. the provider circuit is shared: other companies send nothing either');
  perform pg_temp.ok(pg_temp.reserved(a, '2030-03-01') = 0 and pg_temp.reserved(b, '2030-03-01') = 0, 'J. a refused request reserves nothing');

  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '1 hour', t)->>'decision' = 'probe', 'K. after 1 hour exactly one probe is allowed');
  v_reserved_before := pg_temp.reserved(b, '2030-03-01');
  perform pg_temp.ok(pg_temp.gate(a, t0 + interval '1 hour 1 second', t)->>'decision' = 'circuit_open', 'K. a second caller while the probe is in flight gets circuit_open');
  perform pg_temp.ok(pg_temp.gate(b, t0 + interval '1 hour 2 seconds', tb)->>'decision' = 'circuit_open' and pg_temp.reserved(b, '2030-03-01') = v_reserved_before,
    'K. ... from any company, reserving nothing');

  -- A request that was already in flight when the circuit opened fails late: not the probe.
  perform pg_temp.rec(b, tb, 'provider_error', true, 'auth', t0 + interval '1 hour 3 seconds', 'unauthorized', 401, 'Unauthorized', false);
  c := pg_temp.circuit();
  perform pg_temp.ok(c.probe_backoff_seconds = 3600 and c.next_probe_at = t0 + interval '1 hour' and c.probe_in_flight_until is not null,
    'a late failure from a request that was already in flight does not escalate the backoff or cancel the probe');

  perform pg_temp.rec(a, t, 'provider_error', true, 'auth', t0 + interval '1 hour 5 seconds', 'unauthorized', 401, 'Unauthorized', true);
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'open' and c.probe_backoff_seconds = 7200 and c.next_probe_at = t0 + interval '3 hours 5 seconds' and c.probe_in_flight_until is null,
    'a failed probe keeps the circuit open and doubles the wait to 2 hours');

  v_t := c.next_probe_at;
  foreach v_expected in array array[14400, 28800, 57600, 86400, 86400] loop
    if pg_temp.gate(a, v_t, t)->>'decision' <> 'probe' then v_all_ok := false; end if;
    perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t + interval '5 seconds', 'timeout', null, 'timed out', true);
    c := pg_temp.circuit();
    if c.probe_backoff_seconds <> v_expected or c.state <> 'open' then v_all_ok := false; end if;
    v_t := c.next_probe_at;
  end loop;
  perform pg_temp.ok(v_all_ok, 'repeated failed probes back off 4h, 8h, 16h, then stay at the 24h maximum');

  perform pg_temp.rec(a, t, 'evidence_error', false, 'none', v_t - interval '1 minute');
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'open' and c.probe_backoff_seconds = 86400 and c.next_probe_at = v_t, 'an attempt with no provider interaction never moves the open circuit');

  perform pg_temp.ok(pg_temp.gate(a, v_t, t)->>'decision' = 'probe', 'K. probe due');
  perform pg_temp.rec(a, t, 'evidence_error', false, 'none', v_t, null, null, null, true);
  perform pg_temp.ok((pg_temp.circuit()).probe_in_flight_until is null and pg_temp.gate(a, v_t + interval '1 second', t)->>'decision' = 'probe',
    'a probe that never reached the provider releases its claim, so the next request can probe');
  perform pg_temp.rec(a, t, 'no_confidence', true, 'success', v_t + interval '3 seconds', null, null, null, true);
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'closed' and c.consecutive_timeouts = 0 and c.consecutive_provider_failures = 0 and c.next_probe_at is null
    and c.probe_backoff_seconds = 3600 and c.probe_in_flight_until is null and c.open_reason is null,
    'K. a successful probe closes the circuit and resets it');
  perform pg_temp.ok(pg_temp.gate(b, v_t + interval '4 seconds', tb)->>'decision' = 'allow', 'K. requests flow again for every company');

  -- I. three consecutive timeouts
  perform pg_temp.reset_circuit();
  v_t := '2030-03-20 10:00:00+00';
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t, 'timeout');
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t + interval '1 minute', 'timeout');
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'closed' and c.consecutive_timeouts = 2, 'I. two consecutive timeouts: still closed');
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t + interval '2 minutes', 'timeout');
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'open' and c.open_reason = 'timeout' and c.next_probe_at = v_t + interval '1 hour 2 minutes', 'I. the third consecutive timeout opens the circuit');

  perform pg_temp.reset_circuit();
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t, 'timeout');
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t, 'timeout');
  perform pg_temp.rec(a, t, 'no_confidence', true, 'success', v_t);
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t, 'timeout');
  perform pg_temp.rec(a, t, 'provider_error', true, 'timeout', v_t, 'timeout');
  perform pg_temp.ok((pg_temp.circuit()).state = 'closed', 'I. a successful answer in between resets the timeout count');

  perform pg_temp.reset_circuit();
  for i in 1..4 loop
    perform pg_temp.rec(a, t, 'provider_error', true, 'provider_failure', v_t, 'server-error', 503);
  end loop;
  perform pg_temp.ok((pg_temp.circuit()).state = 'closed' and (pg_temp.circuit()).consecutive_provider_failures = 4, 'four consecutive 5xx failures: still closed');
  perform pg_temp.rec(a, t, 'provider_error', true, 'provider_failure', v_t, 'server-error', 503);
  perform pg_temp.ok((pg_temp.circuit()).state = 'open' and (pg_temp.circuit()).open_reason = 'server-error', 'the fifth consecutive 5xx failure opens the circuit');

  perform pg_temp.reset_circuit();
  for i in 1..10 loop
    perform pg_temp.rec(a, t, 'provider_error', true, 'rate_limit', v_t, 'rate-limit', 429);
  end loop;
  c := pg_temp.circuit();
  perform pg_temp.ok(c.state = 'closed' and c.consecutive_timeouts = 0 and c.consecutive_provider_failures = 0, 'H. a 429 alone never opens the circuit (the batch stops; Retry-After decides the next run)');

  v_all_ok := true;
  foreach v_status in array array[402, 403, 404] loop
    perform pg_temp.reset_circuit();
    perform pg_temp.rec(a, t, 'provider_error', true, 'auth', v_t, 'configuration', v_status);
    if (pg_temp.circuit()).state <> 'open' then v_all_ok := false; end if;
  end loop;
  perform pg_temp.ok(v_all_ok, '402 / 403 / configuration failures open the circuit immediately');

  perform pg_temp.reset_circuit();
end $$;

-- ---------------------------------------------------------------------
-- 4. Internal daily fuse (L, M), exactness, day boundaries, usage (T).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  b uuid := pg_temp.co_b();
  t bigint;
  tb bigint;
  d timestamptz := '2030-04-01 00:00:00+00';
  g jsonb;
  i integer;
  v_all_ok boolean := true;
  v_failed boolean := false;
begin
  perform pg_temp.reset_circuit();
  t := pg_temp.tx(a, '2025-04-01', 'SYN cap');
  tb := pg_temp.tx(b, '2025-04-01', 'SYN cap B');

  -- Five attempts that never reached the provider: reserved, then given back.
  for i in 1..5 loop
    perform pg_temp.gate(a, d, t);
    perform pg_temp.rec(a, t, 'evidence_error', false, 'none', d);
  end loop;
  perform pg_temp.ok(pg_temp.reserved(a, '2030-04-01') = 0, 'reservations for attempts that sent nothing are all given back');

  for i in 1..99 loop
    g := pg_temp.gate(a, d + make_interval(mins => i), t);
    if g->>'decision' <> 'allow' or (g->>'requests_today')::integer <> i - 1 then v_all_ok := false; end if;
    perform pg_temp.rec(a, t, 'no_confidence', true, 'success', d + make_interval(mins => i));
  end loop;
  perform pg_temp.ok(v_all_ok, 'requests 1-99 are allowed, each reporting the count before it');
  g := pg_temp.gate(a, d + interval '2 hours', t);
  perform pg_temp.ok(g->>'decision' = 'allow' and (g->>'requests_today')::integer = 99, 'L. request 100 is allowed');
  perform pg_temp.rec(a, t, 'no_confidence', true, 'success', d + interval '2 hours');
  g := pg_temp.gate(a, d + interval '2 hours 1 minute', t);
  perform pg_temp.ok(g->>'decision' = 'daily_cap' and (g->>'requests_today')::integer = 100 and (g->>'daily_cap')::integer = 100,
    'L. request 101 is prevented');
  perform pg_temp.ok(pg_temp.gate(a, d + interval '2 hours 2 minutes', t, 'manual', 1000)->>'decision' = 'daily_cap',
    'L. a caller cannot raise the fuse above 100');
  perform pg_temp.ok(pg_temp.gate(b, d, tb, 'manual', 0)->>'decision' = 'daily_cap', 'a caller may only lower it');

  perform pg_temp.ok(pg_temp.gate(a, '2030-04-01 23:59:59+00', t)->>'decision' = 'daily_cap', 'L. ... for the rest of that UTC day');
  perform pg_temp.ok(pg_temp.gate(a, '2030-04-02 01:30:00+02', t)->>'decision' = 'daily_cap', 'a timestamp in another time zone counts on its UTC day (01:30+02 = 23:30 UTC)');
  perform pg_temp.ok(pg_temp.gate(a, '2030-04-02 00:00:00+00', t)->>'decision' = 'allow', 'L. the fuse resets at 00:00 UTC');
  perform pg_temp.ok(pg_temp.gate(a, '2030-04-01 22:30:00-02', t)->>'decision' = 'allow' and pg_temp.reserved(a, '2030-04-02') = 2,
    '22:30-02 is already the next UTC day');

  g := pg_temp.gate(b, d + interval '4 hours', tb);
  perform pg_temp.ok(g->>'decision' = 'allow' and (g->>'requests_today')::integer = 0, 'M. another company''s fuse is independent');

  perform pg_temp.ok(pg_temp.reserved(a, '2030-04-01') = 100
    and pg_temp.requests(a, d, d + interval '1 day') = 100
    and (select count(*) from usage_events where company_id = a and metric_key = 'ai_provider_requests' and occurred_at >= d and occurred_at < d + interval '1 day') = 100,
    'T. every provider request is counted exactly once: 100 reserved = 100 attempts = 100 internal usage events');
  perform pg_temp.ok((select counter_value from usage_period_counters where company_id = a and metric_key = 'ai_provider_requests' and period_start = '2030-04-01') = 100,
    'T. the monthly internal counter matches');
  perform pg_temp.ok((select count(*) from usage_events where company_id = a and metric_key = 'ai_requests') = 0,
    'customer ai_requests metering is not touched by the safety layer');

  begin
    perform fn_record_internal_usage_event(a, 'ai_requests', 1, '{}'::jsonb, d);
  exception when others then
    v_failed := sqlerrm like '%not an internal metric%';
  end;
  perform pg_temp.ok(v_failed, 'the internal recorder refuses customer metrics');
end $$;

-- ---------------------------------------------------------------------
-- 5. Candidate selection: order, exclusions, isolation (Y).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  b uuid := pg_temp.co_b();
  t1 bigint; t2 bigint; t3 bigint; t4 bigint; t5 bigint;
  x_suggested bigint; x_allocated bigint; x_override bigint; x_cooldown bigint; x_review bigint; x_resolved bigint;
  tb bigint;
  t0 timestamptz := '2030-05-01 10:00:00+00';
begin
  perform pg_temp.reset_circuit();
  perform pg_temp.clear(a);
  perform pg_temp.clear(b);
  t1 := pg_temp.tx(a, '2024-01-05', 'SYN order 1');
  t2 := pg_temp.tx(a, '2024-01-04', 'SYN order 2');
  t3 := pg_temp.tx(a, '2024-01-01', 'SYN order 3');
  t4 := pg_temp.tx(a, '2024-01-03', 'SYN order 4');
  t5 := pg_temp.tx(a, '2024-01-02', 'SYN order 5');
  perform pg_temp.rec(a, t1, 'provider_error', true, 'none', t0 - interval '1 hour', 'server-error', 503);
  perform pg_temp.rec(a, t2, 'provider_error', true, 'none', t0 - interval '2 hours', 'server-error', 503);

  perform pg_temp.ok(pg_temp.cands(a, t0) = array[t3, t5, t4, t2, t1],
    'selection order: never attempted (oldest transaction first), then least recently attempted');
  perform pg_temp.ok(array_length(pg_temp.cands(a, t0, 2), 1) = 2, 'the batch limit is respected');

  x_suggested := pg_temp.tx(a, '2023-01-01', 'SYN excluded suggested');
  update ae_bank_transactions set suggested_gl_account = '6100', allocation_status = 'Suggested' where id = x_suggested;
  x_allocated := pg_temp.tx(a, '2023-01-02', 'SYN excluded allocated');
  update ae_bank_transactions set allocation_status = 'Allocated' where id = x_allocated;
  x_override := pg_temp.tx(a, '2023-01-03', 'SYN excluded override');
  update ae_bank_transactions set is_manual_override = true where id = x_override;
  x_cooldown := pg_temp.tx(a, '2023-01-04', 'SYN excluded cooldown');
  perform pg_temp.rec(a, x_cooldown, 'no_confidence', true, 'success', t0 - interval '1 day');
  x_review := pg_temp.tx(a, '2023-01-05', 'SYN excluded review');
  perform pg_temp.rec(a, x_review, 'no_confidence', true, 'success', t0 - interval '20 days');
  perform pg_temp.rec(a, x_review, 'no_confidence', true, 'success', t0 - interval '10 days');
  x_resolved := pg_temp.tx(a, '2023-01-06', 'SYN excluded resolved');
  perform pg_temp.rec(a, x_resolved, 'suggested', true, 'success', t0 - interval '5 days');

  perform pg_temp.ok(not (pg_temp.cands(a, t0, 1000) && array[x_suggested, x_allocated, x_override, x_cooldown, x_review, x_resolved]),
    'excluded: already suggested, allocated, manual override, cooldown, needs human review, resolved');

  tb := pg_temp.tx(b, '2020-01-01', 'SYN other company');
  perform pg_temp.ok(not (tb = any (pg_temp.cands(a, t0, 1000))) and pg_temp.cands(b, t0, 1000) = array[tb],
    'Y. each company''s queue contains only its own transactions');
end $$;

-- ---------------------------------------------------------------------
-- 6. Regression simulation of the historical failure (N, O, Y).
--    Company A ("Northwood"): 73 eligible rows, the 20 oldest being the
--    old stuck set. Company B ("Metanoia"): 101 eligible rows. Every
--    provider answer is "no confidence" (the worst case). Day 1 runs a
--    pass every 2 MINUTES (the old loop's cadence) — each pass takes a
--    batch of 20 from the queue, gating every request; then hourly to
--    day 30.
-- ---------------------------------------------------------------------
create temp table sim_passes (company_id uuid, pass_at timestamptz, transaction_id bigint, ord integer);

create function pg_temp.sim_pass(p_company uuid, p_now timestamptz) returns integer language plpgsql as $$
declare
  x bigint;
  n integer := 0;
begin
  foreach x in array pg_temp.cands(p_company, p_now, 20) loop
    exit when pg_temp.gate(p_company, p_now, x, 'sweep')->>'decision' <> 'allow';
    perform pg_temp.rec(p_company, x, 'no_confidence', true, 'success', p_now);
    n := n + 1;
    insert into sim_passes values (p_company, p_now, x, n);
  end loop;
  return n;
end $$;

do $$
declare
  a uuid := pg_temp.co_a();
  b uuid := pg_temp.co_b();
  start timestamptz := '2031-01-06 00:00:00+00';
  t timestamptz;
  i integer;
  stuck bigint[];
  first_pass bigint[];
  second_pass bigint[];
  sum_before text;
  sum_after text;
begin
  perform pg_temp.reset_circuit();
  perform pg_temp.clear(a);
  perform pg_temp.clear(b);
  for i in 1..73 loop
    perform pg_temp.tx(a, date '2024-01-01' + i, 'SYN Northwood ' || i);
  end loop;
  for i in 1..101 loop
    perform pg_temp.tx(b, date '2024-01-01' + i, 'SYN Metanoia ' || i);
  end loop;
  select array_agg(id order by transaction_date, id) into stuck
  from (select id, transaction_date from ae_bank_transactions where company_id = a order by transaction_date, id limit 20) s;
  select md5(string_agg(x::text, '|' order by x.id)) into sum_before from ae_bank_transactions x where company_id in (a, b);

  t := start;
  while t < start + interval '1 day' loop
    perform pg_temp.sim_pass(a, t);
    perform pg_temp.sim_pass(b, t);
    t := t + interval '2 minutes';
  end loop;

  select array_agg(transaction_id order by ord) into first_pass from sim_passes where company_id = a and pass_at = start;
  select array_agg(transaction_id order by ord) into second_pass from sim_passes where company_id = a and pass_at = start + interval '2 minutes';
  perform pg_temp.ok(first_pass = stuck, 'N. historical loop: the first pass asks about exactly the 20 old stuck transactions (20 calls)');
  perform pg_temp.ok((select bool_and(state = 'cooldown') from ai_classification_queue_state where transaction_id = any (stuck)), 'N. those 20 enter the 7-day cooldown');
  perform pg_temp.ok(array_length(second_pass, 1) = 20 and not (second_pass && stuck), 'N. the next pass advances to other eligible rows');
  perform pg_temp.ok(pg_temp.requests(a, start, start + interval '1 day') = 73,
    'N. a pass every 2 minutes for 24h -> 73 provider requests in total (the old loop: 20 x 720 = 14,400)');
  perform pg_temp.ok((select count(*) from ai_classification_attempts where transaction_id = any (stuck)) = 20, 'N. the same 20 are not re-requested');
  perform pg_temp.ok(pg_temp.requests(b, start, start + interval '1 day') = 100 and pg_temp.reserved(b, '2031-01-06') = 100,
    'O. Metanoia (101 rows): day 1 stops at the 100-request safety fuse');
  perform pg_temp.ok(pg_temp.requests(a, start, start + interval '1 day') = 73, 'M. Northwood''s 73 were unaffected by Metanoia reaching its fuse');

  t := start + interval '1 day';
  while t < start + interval '30 days' loop
    perform pg_temp.sim_pass(a, t);
    perform pg_temp.sim_pass(b, t);
    t := t + interval '1 hour';
  end loop;

  perform pg_temp.ok(pg_temp.requests(b, start, start + interval '7 days') = 101, 'O. the first pass over 101 rows is exactly 101 provider requests (100 on day 1, 1 on day 2)');
  perform pg_temp.ok((select max(n) from (select count(*) n from ai_classification_attempts where company_id in (a, b) and attempted_at < start + interval '7 days' group by transaction_id) s) = 1,
    'no transaction was asked twice inside its 7-day cooldown');
  perform pg_temp.ok(pg_temp.requests(a, start, start + interval '30 days') = 146 and pg_temp.requests(b, start, start + interval '30 days') = 202,
    'over 30 days every row is asked at most twice (73 x 2 = 146; 101 x 2 = 202)');
  perform pg_temp.ok((select count(*) from ai_classification_queue_state where company_id = a and state = 'needs_human_review') = 73
    and (select count(*) from ai_classification_queue_state where company_id = b and state = 'needs_human_review') = 101,
    'after the second no-confidence answer every row waits for a human');
  perform pg_temp.ok(pg_temp.cands(a, start + interval '365 days', 1000) = '{}' and pg_temp.cands(b, start + interval '365 days', 1000) = '{}',
    'nothing is selected again automatically');

  select md5(string_agg(x::text, '|' order by x.id)) into sum_after from ae_bank_transactions x where company_id in (a, b);
  perform pg_temp.ok(sum_before = sum_after, 'the whole simulation changed no transaction data (queue state lives in its own table)');
end $$;

-- ---------------------------------------------------------------------
-- 7. Tenant isolation, row-level security and privileges.
--    Both directions: Northwood (A) and Metanoia (B) members.
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a100000-0000-4000-8000-00000000a001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '0a100000-0000-4000-8000-00000000a001', true);
select
  (select count(*) from ai_classification_attempts where company_id = '0a100000-0000-4000-8000-00000000ca00') as own_attempts,
  (select count(*) from ai_classification_attempts where company_id <> '0a100000-0000-4000-8000-00000000ca00') as other_attempts,
  (select count(*) from ai_classification_queue_state where company_id = '0a100000-0000-4000-8000-00000000ca00') as own_queue,
  (select count(*) from ai_classification_queue_state where company_id <> '0a100000-0000-4000-8000-00000000ca00') as other_queue
\gset nw_

do $$
declare
  v_denied boolean;
  v_statement text;
begin
  foreach v_statement in array array[
    'insert into ai_classification_attempts (company_id, transaction_id, source, outcome, provider_request_made) values (''0a100000-0000-4000-8000-00000000ca00'', 1, ''manual'', ''suggested'', true)',
    'update ai_classification_attempts set outcome = ''suggested'' where true',
    'delete from ai_classification_attempts where true',
    'insert into ai_classification_queue_state (transaction_id, company_id) values (1, ''0a100000-0000-4000-8000-00000000ca00'')',
    'update ai_classification_queue_state set state = ''active'' where true',
    'delete from ai_classification_queue_state where true',
    'select * from ai_provider_circuit_state',
    'update ai_provider_circuit_state set state = ''closed'' where true',
    'select * from ai_provider_daily_usage',
    'update ai_provider_daily_usage set reserved_requests = 0 where true',
    'insert into ai_provider_daily_usage (company_id, usage_day) values (''0a100000-0000-4000-8000-00000000ca00'', current_date)',
    'select fn_ai_classification_gate(''0a100000-0000-4000-8000-00000000ca00'', 1, ''manual'', now(), 100, ''transaction-classification'')',
    'select fn_ai_classification_record_attempt(''0a100000-0000-4000-8000-00000000ca00'', 1, null, ''manual'', ''suggested'', true, null, null, null, null, null, 1, ''x'', ''success'', now(), ''transaction-classification'', false)',
    'select * from fn_ai_classification_candidates(''0a100000-0000-4000-8000-00000000cb00'', 20, now())',
    'select fn_ai_classification_reset_queue_state(''0a100000-0000-4000-8000-00000000cb00'', 1)',
    'select fn_ai_provider_circuit_status(''transaction-classification'')',
    'select fn_record_internal_usage_event(''0a100000-0000-4000-8000-00000000ca00'', ''ai_provider_requests'', 1, null, now())'
  ] loop
    v_denied := false;
    begin
      execute v_statement;
    exception when insufficient_privilege then
      v_denied := true;
    end;
    if not v_denied then
      raise exception 'FAIL: a Northwood member was allowed: %', v_statement;
    end if;
  end loop;
  raise notice 'PASS: Northwood members cannot write safety records, cannot see the circuit or daily fuse, and cannot call the safety functions (own or other company)';

  v_denied := false;
  begin
    perform fn_raise_deduplicated_alert('0a100000-0000-4000-8000-00000000cb00', 'x', 'Test', 'warning', 'x', 'x', now());
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: a Northwood member raised an alert on Metanoia';
  end if;
  raise notice 'PASS: Northwood -> Metanoia: alert de-duplication cannot touch another company (RLS)';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a100000-0000-4000-8000-00000000b001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '0a100000-0000-4000-8000-00000000b001', true);
select
  (select count(*) from ai_classification_attempts where company_id = '0a100000-0000-4000-8000-00000000cb00') as own_attempts,
  (select count(*) from ai_classification_attempts where company_id <> '0a100000-0000-4000-8000-00000000cb00') as other_attempts,
  (select count(*) from ai_classification_queue_state where company_id = '0a100000-0000-4000-8000-00000000cb00') as own_queue,
  (select count(*) from ai_classification_queue_state where company_id <> '0a100000-0000-4000-8000-00000000cb00') as other_queue
\gset mt_

do $$
declare
  v_denied boolean;
  v_statement text;
begin
  foreach v_statement in array array[
    'update ai_classification_attempts set outcome = ''suggested'' where true',
    'update ai_classification_queue_state set state = ''active'' where true',
    'select * from ai_provider_circuit_state',
    'select * from ai_provider_daily_usage',
    'select fn_ai_classification_gate(''0a100000-0000-4000-8000-00000000cb00'', 1, ''manual'', now(), 100, ''transaction-classification'')',
    'select * from fn_ai_classification_candidates(''0a100000-0000-4000-8000-00000000ca00'', 20, now())'
  ] loop
    v_denied := false;
    begin
      execute v_statement;
    exception when insufficient_privilege then
      v_denied := true;
    end;
    if not v_denied then
      raise exception 'FAIL: a Metanoia member was allowed: %', v_statement;
    end if;
  end loop;
  raise notice 'PASS: Metanoia members have the same restrictions';

  v_denied := false;
  begin
    perform fn_raise_deduplicated_alert('0a100000-0000-4000-8000-00000000ca00', 'x', 'Test', 'warning', 'x', 'x', now());
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: a Metanoia member raised an alert on Northwood';
  end if;
  raise notice 'PASS: Metanoia -> Northwood: alert de-duplication cannot touch another company (RLS)';
end $$;
reset role;

select pg_temp.ok(:nw_own_attempts > 0 and :nw_other_attempts = 0, 'RLS: Northwood -> own attempts visible, Metanoia''s invisible');
select pg_temp.ok(:nw_own_queue > 0 and :nw_other_queue = 0, 'RLS: Northwood -> own queue state visible, Metanoia''s invisible');
select pg_temp.ok(:mt_own_attempts > 0 and :mt_other_attempts = 0, 'RLS: Metanoia -> own attempts visible, Northwood''s invisible');
select pg_temp.ok(:mt_own_queue > 0 and :mt_other_queue = 0, 'RLS: Metanoia -> own queue state visible, Northwood''s invisible');

-- An anonymous request carries no user claims.
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare
  v_denied boolean;
  v_statement text;
begin
  foreach v_statement in array array[
    'select count(*) from ai_classification_attempts',
    'select count(*) from ai_classification_queue_state',
    'select count(*) from ai_provider_circuit_state',
    'select count(*) from ai_provider_daily_usage'
  ] loop
    v_denied := false;
    begin
      execute v_statement;
    exception when insufficient_privilege then
      v_denied := true;
    end;
    if not v_denied then
      raise exception 'FAIL: an anonymous caller was allowed: %', v_statement;
    end if;
  end loop;
  raise notice 'PASS: anonymous callers have no access to any AI safety table';
end $$;
reset role;

set local role service_role;
do $$
declare
  v_denied boolean;
  v_statement text;
  v_tx bigint;
begin
  foreach v_statement in array array[
    'insert into ai_classification_attempts (company_id, transaction_id, source, outcome, provider_request_made) values (''0a100000-0000-4000-8000-00000000ca00'', 1, ''manual'', ''suggested'', true)',
    'update ai_classification_queue_state set state = ''active'' where true',
    'select * from ai_provider_circuit_state',
    'update ai_provider_circuit_state set state = ''closed'' where true',
    'select * from ai_provider_daily_usage',
    'update ai_provider_daily_usage set reserved_requests = 0 where true'
  ] loop
    v_denied := false;
    begin
      execute v_statement;
    exception when insufficient_privilege then
      v_denied := true;
    end;
    if not v_denied then
      raise exception 'FAIL: the service role wrote/read directly: %', v_statement;
    end if;
  end loop;
  raise notice 'PASS: even the service role reaches the circuit and daily fuse only through the controlled functions';

  if (select count(*) from ai_classification_attempts) = 0 then
    raise exception 'FAIL: the service role (platform) cannot read attempts';
  end if;
  select min(id) into v_tx from ae_bank_transactions where company_id = '0a100000-0000-4000-8000-00000000ca00';
  if (fn_ai_classification_gate('0a100000-0000-4000-8000-00000000ca00', v_tx, 'manual', '2032-01-01 00:00:00+00', 100, 'transaction-classification')->>'decision') is null then
    raise exception 'FAIL: service role could not use the gate';
  end if;
  if (fn_ai_provider_circuit_status('transaction-classification')->>'state') is null then
    raise exception 'FAIL: service role could not read circuit status';
  end if;
  raise notice 'PASS: the service role (platform) reads attempts, uses the gate and reads circuit status through the functions';
end $$;
reset role;

-- ---------------------------------------------------------------------
-- 8. De-duplicated alerts (S).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  b uuid := pg_temp.co_b();
  r1 jsonb; r2 jsonb; rb jsonb; r3 jsonb;
  t0 timestamptz := '2031-03-01 10:00:00+00';
  i integer;
begin
  r1 := fn_raise_deduplicated_alert(a, 'ai-classification:provider-unavailable', 'AI Classification', 'critical', 'Provider unavailable', 'HTTP 401', t0);
  r2 := fn_raise_deduplicated_alert(a, 'ai-classification:provider-unavailable', 'AI Classification', 'critical', 'Provider unavailable', 'HTTP 401 again', t0 + interval '1 hour');
  perform pg_temp.ok((r1->>'created')::boolean and not (r2->>'created')::boolean and r1->>'alert_id' = r2->>'alert_id' and (r2->>'occurrence_count')::integer = 2,
    'S. a repeat updates the existing alert instead of creating another');
  for i in 3..24 loop
    perform fn_raise_deduplicated_alert(a, 'ai-classification:provider-unavailable', 'AI Classification', 'critical', 'Provider unavailable', 'HTTP 401 #' || i, t0 + make_interval(hours => i));
  end loop;
  perform pg_temp.ok((select count(*) from operations_alerts where company_id = a and dedupe_key = 'ai-classification:provider-unavailable') = 1
    and (select occurrence_count from operations_alerts where company_id = a and dedupe_key = 'ai-classification:provider-unavailable') = 24,
    'S. 24 hourly failures -> still ONE alert, with an occurrence count of 24');
  perform pg_temp.ok((select message from operations_alerts where company_id = a and dedupe_key = 'ai-classification:provider-unavailable') = 'HTTP 401 #24'
    and (select last_occurred_at from operations_alerts where company_id = a and dedupe_key = 'ai-classification:provider-unavailable') = t0 + interval '24 hours',
    'S. the alert carries the latest details');

  rb := fn_raise_deduplicated_alert(b, 'ai-classification:provider-unavailable', 'AI Classification', 'critical', 'Provider unavailable', 'HTTP 401', t0);
  perform pg_temp.ok((rb->>'created')::boolean and rb->>'alert_id' <> r1->>'alert_id', 'alerts are de-duplicated per company');

  perform pg_temp.ok(fn_resolve_deduplicated_alert(a, 'ai-classification:provider-unavailable', 'test', t0 + interval '2 days') = 1, 'recovery resolves the alert');
  perform pg_temp.ok(fn_resolve_deduplicated_alert(a, 'ai-classification:provider-unavailable', 'test', t0 + interval '2 days') = 0, 'resolving again is a no-op');
  r3 := fn_raise_deduplicated_alert(a, 'ai-classification:provider-unavailable', 'AI Classification', 'critical', 'Provider unavailable', 'new outage', t0 + interval '3 days');
  perform pg_temp.ok((r3->>'created')::boolean and r3->>'alert_id' <> r1->>'alert_id', 'a new outage after recovery raises a new alert');

  insert into operations_alerts (company_id, source_engine, severity, title) values (a, 'Test', 'info', 'plain'), (a, 'Test', 'info', 'plain');
  perform pg_temp.ok((select count(*) from operations_alerts where company_id = a and title = 'plain' and dedupe_key is null) = 2, 'ordinary alerts without a dedupe key are unaffected');
end $$;

-- ---------------------------------------------------------------------
-- 9. Suspended automation tasks (R).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  v_id bigint;
  v_failed boolean := false;
  t0 timestamptz := '2031-04-01 10:00:00+00';
begin
  insert into automation_tasks (company_id, task_type, name, next_run_at, status, retry_count)
  values (a, 'AiClassificationSweep', 'SYN sweep', t0, 'Failed', 3) returning id into v_id;
  -- What the scheduler writes when retries are exhausted (recordTaskOutcome + suspendTask).
  update automation_tasks set status = 'Suspended', is_active = false, suspended_reason = 'AI Classification sweep could not run safely', suspended_at = t0 where id = v_id;
  perform pg_temp.ok(exists (select 1 from automation_tasks where id = v_id and status = 'Suspended' and not is_active and suspended_reason is not null and suspended_at = t0),
    'R. Suspended is a valid task status, inactive, with a reason and time');
  perform pg_temp.ok(not exists (select 1 from automation_tasks where id = v_id and is_active and status in ('Queued', 'Success', 'Failed') and next_run_at <= t0 + interval '100 years'),
    'R. the scheduler''s due-task filter never selects a Suspended task');
  -- Even if a manual run later wrote a runnable status, the task stays inactive until Resume.
  update automation_tasks set status = 'Success' where id = v_id;
  perform pg_temp.ok(not exists (select 1 from automation_tasks where id = v_id and is_active and status in ('Queued', 'Success', 'Failed')),
    'R. an inactive (suspended) task is not due even if its status label changes');
  begin
    update automation_tasks set status = 'Bogus' where id = v_id;
  exception when check_violation then
    v_failed := true;
  end;
  perform pg_temp.ok(v_failed, 'unknown task statuses are still rejected');
end $$;

-- ---------------------------------------------------------------------
-- 10. Accounting boundary (static): the safety functions never write
--     accounting tables.
-- ---------------------------------------------------------------------
select pg_temp.ok(not exists (
  select 1 from pg_proc
  where proname in ('fn_ai_classification_gate', 'fn_ai_classification_record_attempt', 'fn_ai_classification_candidates',
                    'fn_ai_classification_reset_queue_state', 'fn_ai_provider_circuit_status', 'fn_record_internal_usage_event',
                    'fn_raise_deduplicated_alert', 'fn_resolve_deduplicated_alert')
    and prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(ae_|journal|sales_|purchase|bill|invoice|chart_of_accounts|customers|suppliers|bank_|payment)'
), 'the AI safety functions contain no writes to accounting tables');

rollback;
\echo 'ai_classification_safety: all checks passed (transaction rolled back)'
