-- Phase 5N — certification boundaries. LOCAL ONLY.
--
-- Two unrelated things, both additive, both in service of running a live
-- certification safely once a non-production credential exists.
--
--   1. `supplier_invoice_captures.document_type` — so a credit note can be
--      REFUSED at the accounting boundary rather than only questioned at
--      validation.
--   2. A certification call ceiling — a finite, atomic, fail-closed limit
--      on provider calls during a certification run, separate from and
--      additional to the 200/day operational budget.
--
-- NOT COMMERCIAL. Neither of these is metering, billing or a customer
-- quota. The certification ceiling in particular must never be presented
-- as customer usage: it exists so an unattended certification run cannot
-- spend an unbounded amount of someone's money, and it is deleted along
-- with the run.

-- ---------------------------------------------------------------------
-- 1. The document's own kind.
--
--    Phase 5M taught the model to report `documentType` and taught
--    validation to refuse anything that is not an invoice. But the value
--    was thrown away at persist time, so the refusal lived only in the
--    validation finding — one layer, dependent on the model having read
--    the heading. Storing it lets `assessConversion` refuse structurally,
--    and lets the review screen SAY what the document is, which is more
--    useful to a person than "this could not be captured".
--
--    Nullable on purpose: unknown is unknown, and the overwhelming
--    majority of existing rows predate the field. A null is treated as
--    "not known to be anything other than an invoice" — the validation
--    finding remains the layer that catches an unread heading.
-- ---------------------------------------------------------------------
alter table supplier_invoice_captures
  add column if not exists document_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_invoice_captures_document_type_check'
  ) then
    alter table supplier_invoice_captures
      add constraint supplier_invoice_captures_document_type_check
      check (document_type is null or document_type in ('Invoice', 'Credit Note', 'Debit Note', 'Other'));
  end if;
end
$$;

comment on column supplier_invoice_captures.document_type is
  'What the extraction read the document''s heading as. Informational for review, and a structural refusal at conversion for anything that is not an Invoice. Never used to change an accounting sign.';

-- ---------------------------------------------------------------------
-- 2. The certification call ceiling.
--
--    WHY THIS IS NOT THE DAILY BUDGET. The operational budget
--    (`ai_provider_scope_budgets`, 200/day for supplier-invoice-
--    extraction) answers "how much AI may this company use in a day". A
--    certification run asks a different question: "how many provider calls
--    may THIS EXPERIMENT make, in total, before a human looks at the
--    results again". Raising the daily budget to accommodate a
--    certification run would be exactly the wrong move — it would leave
--    production more exposed afterwards, which is how a temporary
--    allowance becomes permanent.
--
--    Both apply. A certification call must fit inside the daily budget AND
--    inside the run's ceiling; whichever binds first refuses.
--
--    THE FIVE PROPERTIES THE BRIEF REQUIRES, AND WHERE EACH LIVES:
--
--    finite       `call_ceiling` is not null and must be > 0. There is no
--                 "unlimited" value, and no null meaning unlimited.
--    visible      one row per run, with `calls_used` readable at any time.
--    atomic       the reservation is a single conditional UPDATE that
--                 re-checks `calls_used < call_ceiling` under the row lock
--                 it takes. Two workers cannot both see room for the last
--                 call — the same technique 0099 and 0107 use.
--    fail-closed  no row updated => not reserved. A closed run, an
--                 exhausted run, a wrong id and a missing row all refuse
--                 identically. There is no path that grants a call.
--    intentional  nothing here raises a ceiling or resets a counter.
--                 Continuing past a ceiling means opening a NEW run, which
--                 is a deliberate act with its own row, label and
--                 timestamp. "Just bump it" is not an available move.
--
--    At most one run may be Open per company at a time, so "open a second
--    run" cannot be used to quietly double an allowance while the first is
--    still going.
-- ---------------------------------------------------------------------
create table if not exists ai_certification_runs (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  -- What this run was for, in a human's words. Read back in the report.
  label text not null,
  call_ceiling integer not null check (call_ceiling > 0),
  calls_used integer not null default 0 check (calls_used >= 0),
  status text not null default 'Open' check (status in ('Open', 'Exhausted', 'Closed')),
  opened_by text not null default '',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Belt and braces: the reservation UPDATE enforces this, and so does the
  -- table, so a direct UPDATE cannot push a run past its own ceiling.
  constraint ai_certification_runs_within_ceiling check (calls_used <= call_ceiling)
);

alter table ai_certification_runs enable row level security;
revoke all on table ai_certification_runs from public, anon, authenticated, service_role;

-- One Open run per company. A second concurrent run would be two ceilings
-- for one experiment, which is no ceiling.
create unique index if not exists ai_certification_runs_one_open_per_company
  on ai_certification_runs (company_id)
  where status = 'Open';

comment on table ai_certification_runs is
  'Phase 5N. A finite provider-call ceiling for one AI certification run. Operational safety, never billing or customer usage.';

-- Opening a run is deliberate and recorded.
create or replace function fn_ai_certification_open_run(
  p_company_id uuid,
  p_label text,
  p_call_ceiling integer,
  p_opened_by text default ''
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_call_ceiling is null or p_call_ceiling <= 0 then
    raise exception 'fn_ai_certification_open_run: a certification run needs a finite ceiling greater than zero';
  end if;
  if coalesce(btrim(p_label), '') = '' then
    raise exception 'fn_ai_certification_open_run: a certification run must say what it is for';
  end if;

  insert into ai_certification_runs (company_id, label, call_ceiling, opened_by)
  values (p_company_id, btrim(p_label), p_call_ceiling, coalesce(p_opened_by, ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- The reservation. One call = one row-locked increment, or a refusal.
--
-- Returns jsonb: {reserved, calls_used, call_ceiling, status, reason}
create or replace function fn_ai_certification_reserve_call(p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
  v_ceiling integer;
  v_status text;
begin
  -- The whole safety property is in this one statement. The row is locked
  -- by the UPDATE, the count is re-read under that lock, and a caller that
  -- loses the race matches no row and is refused. Reading then writing
  -- would let two workers both see room for the final call.
  update ai_certification_runs
  set calls_used = calls_used + 1, updated_at = now()
  where id = p_run_id
    and status = 'Open'
    and calls_used < call_ceiling
  returning calls_used, call_ceiling into v_used, v_ceiling;

  if v_used is null then
    -- Fail closed. Report WHY without ever granting the call.
    select status, calls_used, call_ceiling into v_status, v_used, v_ceiling
    from ai_certification_runs where id = p_run_id;

    return jsonb_build_object(
      'reserved', false,
      'calls_used', coalesce(v_used, 0),
      'call_ceiling', coalesce(v_ceiling, 0),
      'status', coalesce(v_status, 'Missing'),
      'reason', case
        when v_status is null then 'No such certification run.'
        when v_status <> 'Open' then 'This certification run is ' || v_status || '.'
        else 'This certification run has reached its call ceiling.'
      end
    );
  end if;

  -- Reaching the ceiling closes the run to further calls immediately,
  -- rather than leaving it Open and refusing one at a time. The state is
  -- then honest at a glance.
  if v_used >= v_ceiling then
    update ai_certification_runs
    set status = 'Exhausted', closed_at = now(), updated_at = now()
    where id = p_run_id and status = 'Open';
  end if;

  return jsonb_build_object(
    'reserved', true,
    'calls_used', v_used,
    'call_ceiling', v_ceiling,
    'status', case when v_used >= v_ceiling then 'Exhausted' else 'Open' end,
    'reason', ''
  );
end;
$$;

-- Ending a run. Deliberately does NOT reset `calls_used` — the record of
-- what a run spent outlives the run.
create or replace function fn_ai_certification_close_run(p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row ai_certification_runs;
begin
  update ai_certification_runs
  set status = 'Closed', closed_at = now(), updated_at = now()
  where id = p_run_id and status in ('Open', 'Exhausted')
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('closed', false, 'reason', 'No open certification run with that id.');
  end if;

  return jsonb_build_object(
    'closed', true,
    'calls_used', v_row.calls_used,
    'call_ceiling', v_row.call_ceiling,
    'reason', ''
  );
end;
$$;
