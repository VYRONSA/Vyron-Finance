-- Phase SD-3F — Supplier Document Intelligence: the supplier-statement AI
-- boundary. LIVE AI STAYS OFF.
--
-- This migration adds the controls an AI statement reader would run inside —
-- budget, circuit breaker, attempt audit, provenance — and turns NOTHING on.
-- Whether a provider is ever called is decided by the application's
-- certification switch (VYRON_AI_STATEMENT_EXTRACTION=certification AND a
-- configured key); without it, scanned statements keep going to manual
-- entry exactly as in SD-3C.
--
-- What AI may do (when certified): TRANSCRIBE printed text. What it may
-- never do: calculate a value, invent one, choose or confirm a supplier,
-- reconcile, match, or touch an accounting record. Its output is untrusted
-- evidence: it is parsed by the deterministic statement reader's own
-- parsers and must pass the same arithmetic validation before the statement
-- can be marked ready.
--
-- WHAT THIS ADDS
--   * Budget scope 'supplier-statement-extraction' (50 requests/company/day).
--     Scopes now total 350, under the 500 provider-wide fuse.
--   * ai_statement_extraction_attempts — append-only, METADATA ONLY (no
--     prompt, no response, no document content).
--   * Two SHARED helpers so the circuit rules are not copied a third time:
--     fn_ai_scope_gate (circuit + two-layer reservation + probe claim) and
--     fn_ai_scope_record_signal (moves the scope's circuit). The existing
--     0107/0108 functions are not modified.
--   * fn_ai_statement_extraction_gate / _record_attempt — statement-scoped,
--     service role only.
--   * supplier_statement_lines.extracted_by — 'reader' (deterministic
--     layout/tabular), 'ai', or 'reviewer'; set by the system, never by a
--     user, so AI-read values are always distinguishable from reviewer
--     entries (a reviewer correction is marked by `corrected`).
--   * extraction_method 'ai'; AI lifecycle event types.
--   * Explicit grants on every object.
--
-- ORDER: … → 0114 → 0115 → 0116. Idempotent.

-- ---------------------------------------------------------------------
-- 1. Budget scope and circuit row.
-- ---------------------------------------------------------------------
insert into ai_provider_scope_budgets (scope, daily_request_cap, description) values
  ('supplier-statement-extraction', 50, 'SD-3F supplier statement reading (scanned statements). One request per statement; off unless certified.')
on conflict (scope) do nothing;

insert into ai_provider_circuit_state (scope) values ('supplier-statement-extraction') on conflict (scope) do nothing;

-- ---------------------------------------------------------------------
-- 2. Provenance and vocabulary.
-- ---------------------------------------------------------------------
alter table supplier_statements drop constraint if exists supplier_statements_extraction_method_check;
alter table supplier_statements add constraint supplier_statements_extraction_method_check
  check (extraction_method in ('layout', 'tabular', 'manual', 'ai'));

alter table supplier_statement_lines add column if not exists extracted_by text not null default 'reader';
alter table supplier_statement_lines drop constraint if exists supplier_statement_lines_extracted_by_check;
alter table supplier_statement_lines add constraint supplier_statement_lines_extracted_by_check
  check (extracted_by in ('reader', 'ai', 'reviewer'));

alter table supplier_statement_events drop constraint if exists supplier_statement_events_event_type_check;
alter table supplier_statement_events add constraint supplier_statement_events_event_type_check check (event_type in (
  'Uploaded', 'DuplicateEvaluated', 'ProcessingStarted', 'Extracted', 'ExtractionFailed', 'ManualEntryRequired',
  'ValidationEvaluated', 'SupplierProposed', 'SupplierConfirmed', 'SupplierUnconfirmed', 'SupplierAccountNumberSaved',
  'FieldCorrected', 'LineCorrected', 'LineAdded', 'LineRemoved', 'ManualEntryStarted', 'SubmittedForReview',
  'MarkedReady', 'Reopened', 'Rejected', 'ProcessingRequeued',
  'ReconciliationRun', 'ResolutionRecorded', 'ResolutionRevoked',
  'AiExtractionSkipped', 'AiExtractionRefused', 'AiExtracted', 'AiExtractionFailed'));

-- ---------------------------------------------------------------------
-- 3. Attempts — append-only, metadata only.
-- ---------------------------------------------------------------------
create table if not exists ai_statement_extraction_attempts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  statement_id bigint not null references supplier_statements (id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  attempted_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  outcome text not null check (outcome in (
    'extracted',          -- a usable transcription was stored (still validated deterministically)
    'validation_failed',  -- the provider answered; the deterministic checks rejected it
    'invalid_response',   -- the provider answered; the answer did not fit the schema
    'provider_error',     -- the provider failed
    'document_error',     -- the document could not be sent (no request made)
    'write_error'         -- the answer could not be saved
  )),
  provider_request_made boolean not null,
  provider text not null default 'vercel-ai-gateway',
  model text,
  error_category text,
  http_status integer,
  provider_message text check (provider_message is null or char_length(provider_message) <= 300),
  usage jsonb,
  pages_sent integer check (pages_sent is null or pages_sent between 0 and 60),
  performed_by text not null default 'PRECISIA AI'
);
create index if not exists ai_statement_extraction_attempts_company_time_idx on ai_statement_extraction_attempts (company_id, attempted_at desc);
create index if not exists ai_statement_extraction_attempts_statement_idx on ai_statement_extraction_attempts (statement_id, attempt_number);

alter table ai_statement_extraction_attempts enable row level security;
revoke all on table ai_statement_extraction_attempts from public, anon, authenticated, service_role;
grant select on table ai_statement_extraction_attempts to authenticated, service_role;
drop policy if exists "purchasing view reads statement extraction attempts" on ai_statement_extraction_attempts;
create policy "purchasing view reads statement extraction attempts" on ai_statement_extraction_attempts for select
  using (user_has_permission(company_id, 'Purchasing:View'));

create or replace function fn_ai_statement_extraction_attempts_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'ai_statement_extraction_attempts is append-only: it cannot be truncated'; end if;
  if tg_op = 'UPDATE' then raise exception 'ai_statement_extraction_attempts is append-only: a recorded attempt cannot be modified'; end if;
  if pg_trigger_depth() <= 1 then raise exception 'ai_statement_extraction_attempts is append-only: a recorded attempt cannot be deleted'; end if;
  return old;
end;
$$;
revoke execute on function fn_ai_statement_extraction_attempts_immutable() from public, anon, authenticated, service_role;
drop trigger if exists ai_statement_extraction_attempts_immutable on ai_statement_extraction_attempts;
create trigger ai_statement_extraction_attempts_immutable before update or delete on ai_statement_extraction_attempts
  for each row execute function fn_ai_statement_extraction_attempts_immutable();
drop trigger if exists ai_statement_extraction_attempts_no_truncate on ai_statement_extraction_attempts;
create trigger ai_statement_extraction_attempts_no_truncate before truncate on ai_statement_extraction_attempts
  for each statement execute function fn_ai_statement_extraction_attempts_immutable();

-- ---------------------------------------------------------------------
-- 4. Shared scope helpers (the circuit rules, once).
--    Same rules as 0108's extraction functions: auth opens immediately,
--    3 consecutive timeouts or 5 consecutive provider failures open it; an
--    open circuit admits one probe after its back-off; a failed probe doubles
--    the back-off (max 24 h); success closes it.
-- ---------------------------------------------------------------------
create or replace function fn_ai_scope_gate(p_company_id uuid, p_scope text, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c ai_provider_circuit_state%rowtype;
  v_reservation jsonb;
  v_probe boolean := false;
  v_claimed text;
begin
  if p_scope is null or p_scope = '__provider__' then
    raise exception 'fn_ai_scope_gate: a feature scope is required';
  end if;
  select * into c from ai_provider_circuit_state where scope = p_scope;
  if not found then
    insert into ai_provider_circuit_state (scope) values (p_scope) on conflict (scope) do nothing;
    select * into c from ai_provider_circuit_state where scope = p_scope;
  end if;
  if c.state = 'open' then
    if c.next_probe_at is null or p_now < c.next_probe_at
       or (c.probe_in_flight_until is not null and p_now < c.probe_in_flight_until) then
      return jsonb_build_object('decision', 'circuit_open', 'circuit_state', 'open', 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
    end if;
    v_probe := true;
  end if;

  v_reservation := fn_ai_reserve_request(p_company_id, p_scope, p_now);
  if not (v_reservation ->> 'reserved')::boolean then
    return jsonb_build_object('decision', 'daily_cap', 'circuit_state', c.state, 'refused_layer', v_reservation ->> 'refused_layer',
      'requests_today', (v_reservation ->> 'scope_used')::integer, 'daily_cap', (v_reservation ->> 'scope_cap')::integer);
  end if;

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
        return jsonb_build_object('decision', 'circuit_open', 'circuit_state', 'open', 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
      end if;
      v_probe := false;
    end if;
  end if;

  return jsonb_build_object('decision', case when v_probe then 'probe' else 'allow' end,
    'circuit_state', case when v_probe then 'open' else 'closed' end,
    'requests_today', (v_reservation ->> 'scope_used')::integer, 'daily_cap', (v_reservation ->> 'scope_cap')::integer);
end;
$$;
revoke execute on function fn_ai_scope_gate(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function fn_ai_scope_gate(uuid,text,timestamptz) to service_role;

create or replace function fn_ai_scope_record_signal(
  p_scope text,
  p_signal text,
  p_error_category text,
  p_http_status integer,
  p_message text,
  p_probe boolean,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c ai_provider_circuit_state%rowtype;
  v_message text := left(p_message, 300);
  v_backoff integer;
begin
  if p_signal not in ('success', 'auth', 'timeout', 'provider_failure', 'rate_limit', 'none') then
    raise exception 'fn_ai_scope_record_signal: unknown circuit signal "%"', p_signal;
  end if;
  select * into c from ai_provider_circuit_state where scope = p_scope for update;
  if not found then
    insert into ai_provider_circuit_state (scope) values (p_scope) on conflict (scope) do nothing;
    select * into c from ai_provider_circuit_state where scope = p_scope for update;
  end if;

  if p_signal = 'success' then
    update ai_provider_circuit_state
    set state = 'closed', consecutive_timeouts = 0, consecutive_provider_failures = 0, opened_at = null, open_reason = null,
        next_probe_at = null, probe_backoff_seconds = 3600, probe_in_flight_until = null, updated_at = now()
    where scope = p_scope;
  elsif p_signal in ('auth', 'timeout', 'provider_failure', 'rate_limit') then
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
    elsif p_signal = 'auth'
       or (p_signal = 'timeout' and c.consecutive_timeouts + 1 >= 3)
       or (p_signal = 'provider_failure' and c.consecutive_provider_failures + 1 >= 5) then
      update ai_provider_circuit_state
      set state = 'open', opened_at = p_now, open_reason = coalesce(p_error_category, p_signal),
          consecutive_timeouts = case when p_signal = 'timeout' then c.consecutive_timeouts + 1 else c.consecutive_timeouts end,
          consecutive_provider_failures = case when p_signal = 'provider_failure' then c.consecutive_provider_failures + 1 else c.consecutive_provider_failures end,
          probe_backoff_seconds = 3600, next_probe_at = p_now + interval '1 hour', probe_in_flight_until = null,
          last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message, updated_at = now()
      where scope = p_scope;
    else
      update ai_provider_circuit_state
      set consecutive_timeouts = case when p_signal = 'timeout' then c.consecutive_timeouts + 1 else c.consecutive_timeouts end,
          consecutive_provider_failures = case when p_signal = 'provider_failure' then c.consecutive_provider_failures + 1 else c.consecutive_provider_failures end,
          last_error_category = p_error_category, last_http_status = p_http_status, last_error_message = v_message, updated_at = now()
      where scope = p_scope;
    end if;
  elsif p_probe and c.state = 'open' then
    update ai_provider_circuit_state set probe_in_flight_until = null, updated_at = now() where scope = p_scope;
  end if;

  select * into c from ai_provider_circuit_state where scope = p_scope;
  return jsonb_build_object('circuit_state', c.state, 'open_reason', c.open_reason, 'next_probe_at', c.next_probe_at);
end;
$$;
revoke execute on function fn_ai_scope_record_signal(text,text,text,integer,text,boolean,timestamptz) from public, anon, authenticated;
grant execute on function fn_ai_scope_record_signal(text,text,text,integer,text,boolean,timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 5. Statement gate and attempt recorder (service role only).
-- ---------------------------------------------------------------------
create or replace function fn_ai_statement_extraction_gate(p_company_id uuid, p_statement_id bigint, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_status text;
begin
  select company_id, status into v_company, v_status from supplier_statements where id = p_statement_id;
  if v_company is null or v_company <> p_company_id then
    raise exception 'fn_ai_statement_extraction_gate: statement % does not belong to company %', p_statement_id, p_company_id;
  end if;
  -- Only a statement that is being processed may be sent; never one a
  -- person is already reviewing or that has been reconciled.
  if v_status <> 'Processing' then
    return jsonb_build_object('decision', 'not_processing', 'status', v_status);
  end if;
  return fn_ai_scope_gate(p_company_id, 'supplier-statement-extraction', p_now);
end;
$$;
revoke execute on function fn_ai_statement_extraction_gate(uuid,bigint,timestamptz) from public, anon, authenticated;
grant execute on function fn_ai_statement_extraction_gate(uuid,bigint,timestamptz) to service_role;

create or replace function fn_ai_statement_extraction_record_attempt(
  p_company_id uuid,
  p_statement_id bigint,
  p_outcome text,
  p_provider_request_made boolean,
  p_model text,
  p_error_category text,
  p_http_status integer,
  p_provider_message text,
  p_usage jsonb,
  p_duration_ms integer,
  p_pages_sent integer,
  p_performed_by text,
  p_circuit_signal text,
  p_probe boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_attempt integer;
begin
  select company_id into v_company from supplier_statements where id = p_statement_id;
  if v_company is null or v_company <> p_company_id then
    raise exception 'fn_ai_statement_extraction_record_attempt: statement % does not belong to company %', p_statement_id, p_company_id;
  end if;
  select coalesce(max(attempt_number), 0) + 1 into v_attempt from ai_statement_extraction_attempts where statement_id = p_statement_id;

  insert into ai_statement_extraction_attempts (company_id, statement_id, attempt_number, attempted_at, duration_ms, outcome,
    provider_request_made, model, error_category, http_status, provider_message, usage, pages_sent, performed_by)
  values (p_company_id, p_statement_id, v_attempt, p_now, p_duration_ms, p_outcome, p_provider_request_made, p_model,
    p_error_category, p_http_status, left(p_provider_message, 300), p_usage, p_pages_sent, coalesce(p_performed_by, 'PRECISIA AI'));

  if p_provider_request_made then
    perform fn_record_internal_usage_event(p_company_id, 'ai_provider_requests', 1,
      jsonb_build_object('scope', 'supplier-statement-extraction', 'outcome', p_outcome, 'statement_id', p_statement_id,
        'error_category', p_error_category), p_now);
  else
    -- Nothing reached the provider: give the reservation back.
    perform fn_ai_release_request(p_company_id, 'supplier-statement-extraction', p_now);
  end if;

  return fn_ai_scope_record_signal('supplier-statement-extraction', p_circuit_signal, p_error_category, p_http_status, p_provider_message, p_probe, p_now)
    || jsonb_build_object('attempt_number', v_attempt);
end;
$$;
revoke execute on function fn_ai_statement_extraction_record_attempt(uuid,bigint,text,boolean,text,text,integer,text,jsonb,integer,integer,text,text,boolean,timestamptz) from public, anon, authenticated;
grant execute on function fn_ai_statement_extraction_record_attempt(uuid,bigint,text,boolean,text,text,integer,text,jsonb,integer,integer,text,text,boolean,timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 6. Line guard: `extracted_by` is system-owned. A reviewer's new line is
--    'reviewer'; an existing line keeps how it was read (its correction is
--    shown by `corrected`). Body otherwise as 0114.
-- ---------------------------------------------------------------------
create or replace function fn_supplier_statement_line_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row supplier_statement_lines;
  v_status text;
  v_company uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier statements require a signed-in user' using errcode = '42501';
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  select s.status, s.company_id into v_status, v_company from supplier_statements s where s.id = v_row.statement_id;
  if not found or v_company is distinct from v_row.company_id then
    raise exception 'the statement does not belong to this company' using errcode = '42501';
  end if;
  if not user_has_permission(v_company, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required to change statement lines' using errcode = '42501';
  end if;
  if v_status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only a statement in review or manual entry can have its lines changed (it is %)', v_status using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if cardinality(new.unresolved_fields) <> 0 or new.raw_text is not null then
      raise exception 'a line entered by a reviewer has no unread values' using errcode = '42501';
    end if;
    new.corrected := true;
    new.type_source := 'reviewer';
    new.extracted_by := 'reviewer';
    new.created_at := now();
    new.updated_at := now();
    perform fn_supplier_statement_mark_unvalidated(new.statement_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform fn_supplier_statement_mark_unvalidated(old.statement_id);
    return old;
  end if;

  if (new.id, new.company_id, new.statement_id, new.line_order, new.page_number, new.row_on_page, new.raw_text, new.created_at, new.extracted_by)
     is distinct from (old.id, old.company_id, old.statement_id, old.line_order, old.page_number, old.row_on_page, old.raw_text, old.created_at, old.extracted_by) then
    raise exception 'a line''s identity and provenance cannot be changed' using errcode = '42501';
  end if;
  if new.unresolved_fields is distinct from old.unresolved_fields then
    raise exception 'unread values are resolved by correcting them, not by editing the list' using errcode = '42501';
  end if;

  new.unresolved_fields := array(
    select f from unnest(old.unresolved_fields) f
    where (f = 'transaction_date' and new.transaction_date is not distinct from old.transaction_date)
       or (f = 'reference_text' and new.reference_text is not distinct from old.reference_text)
       or (f = 'debit' and new.debit is not distinct from old.debit and new.credit is not distinct from old.credit)
       or (f = 'credit' and new.credit is not distinct from old.credit and new.debit is not distinct from old.debit)
       or (f = 'running_balance' and new.running_balance is not distinct from old.running_balance)
       or (f = 'transaction_type' and new.transaction_type is not distinct from old.transaction_type)
  );
  if new.transaction_type is distinct from old.transaction_type then
    new.type_source := 'reviewer';
  elsif new.type_source is distinct from old.type_source then
    raise exception 'how a line''s type was decided is recorded by the system' using errcode = '42501';
  end if;
  new.corrected := true;
  new.updated_at := clock_timestamp();
  perform fn_supplier_statement_mark_unvalidated(new.statement_id);
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_line_guard() from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
