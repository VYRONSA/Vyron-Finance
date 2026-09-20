-- Database tests for migration 0107 (scope-specific AI usage budgets).
--
-- LOCAL / SYNTHETIC DATA ONLY. Everything runs in ONE transaction that is
-- rolled back at the end, so nothing is left behind. Never run against a
-- shared or production database.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ai_scope_budgets.test.sql
--
-- The companion suite `ai_classification_safety.test.sql` proves the
-- EXISTING classification behaviour is unchanged by this migration. This
-- one proves the new behaviour: two independent layers, atomic
-- reservation, correct give-back, and no cross-scope interference.

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function pg_temp.used(p_company uuid, p_scope text) returns integer language sql as $$
  select coalesce((select reserved_requests from ai_provider_daily_usage
    where company_id = p_company and scope = p_scope
      and usage_day = (now() at time zone 'UTC')::date), 0)
$$;

-- Two synthetic companies so cross-tenant independence can be asserted.
create function pg_temp.co_a() returns uuid language sql as $$ select '5b000000-0000-4000-8000-00000000a001'::uuid $$;
create function pg_temp.co_b() returns uuid language sql as $$ select '5b000000-0000-4000-8000-00000000b002'::uuid $$;

insert into organisations (id, name) values ('5b000000-0000-4000-8000-0000000000aa', '5L budget org')
on conflict (id) do nothing;
insert into companies (id, organisation_id, name)
values (pg_temp.co_a(), '5b000000-0000-4000-8000-0000000000aa', '5L Budget A'),
       (pg_temp.co_b(), '5b000000-0000-4000-8000-0000000000aa', '5L Budget B')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 1. Budget resolution
-- ---------------------------------------------------------------------
do $$
declare a uuid := pg_temp.co_a();
begin
  perform pg_temp.ok(fn_ai_resolve_daily_cap(a, 'transaction-classification') = 100,
    'classification keeps its 100/day budget — the existing behaviour is represented, not approximated');
  perform pg_temp.ok(fn_ai_resolve_daily_cap(a, 'supplier-invoice-extraction') = 200,
    'supplier invoice extraction has its own budget');
  perform pg_temp.ok(fn_ai_resolve_daily_cap(a, '__provider__') = 500,
    'the provider-wide emergency fuse survives as a separate, higher layer');
  perform pg_temp.ok(fn_ai_resolve_daily_cap(a, 'no-such-scope') = 0,
    'an unknown scope gets no allowance — refused, never silently granted');

  insert into ai_provider_company_budget_overrides (company_id, scope, daily_request_cap, reason)
  values (a, 'supplier-invoice-extraction', 7, 'test override');
  perform pg_temp.ok(fn_ai_resolve_daily_cap(a, 'supplier-invoice-extraction') = 7,
    'a per-company override wins over the scope default — the budget is configurable');
  perform pg_temp.ok(fn_ai_resolve_daily_cap(pg_temp.co_b(), 'supplier-invoice-extraction') = 200,
    'one company''s override does not affect another company');
  delete from ai_provider_company_budget_overrides where company_id = a;
end $$;

-- ---------------------------------------------------------------------
-- 2. Reservation reserves BOTH layers; scopes do not compete
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  r jsonb;
begin
  r := fn_ai_reserve_request(a, 'supplier-invoice-extraction');
  perform pg_temp.ok((r->>'reserved')::boolean, 'a request within budget is reserved');
  perform pg_temp.ok(pg_temp.used(a, 'supplier-invoice-extraction') = 1, 'the scope counter moved');
  perform pg_temp.ok(pg_temp.used(a, '__provider__') = 1, 'the emergency fuse counter moved too — both layers, always');
  perform pg_temp.ok(pg_temp.used(a, 'transaction-classification') = 0,
    'THE POINT OF THIS MIGRATION: invoice extraction did not consume classification''s allowance');

  perform fn_ai_release_request(a, 'supplier-invoice-extraction');
  perform pg_temp.ok(pg_temp.used(a, 'supplier-invoice-extraction') = 0 and pg_temp.used(a, '__provider__') = 0,
    'releasing a request that never reached the provider gives back both layers');
end $$;

-- ---------------------------------------------------------------------
-- 3. The scope budget binds, and binding it leaves other scopes alone
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  r jsonb;
  i integer;
begin
  insert into ai_provider_company_budget_overrides (company_id, scope, daily_request_cap)
  values (a, 'supplier-invoice-extraction', 3);

  for i in 1..3 loop
    perform pg_temp.ok((fn_ai_reserve_request(a, 'supplier-invoice-extraction')->>'reserved')::boolean,
      format('request %s of the 3-request budget is allowed', i));
  end loop;

  r := fn_ai_reserve_request(a, 'supplier-invoice-extraction');
  perform pg_temp.ok(not (r->>'reserved')::boolean, 'the 4th request is refused');
  perform pg_temp.ok(r->>'refused_layer' = 'scope', 'and it names WHICH layer refused it');
  perform pg_temp.ok(pg_temp.used(a, 'supplier-invoice-extraction') = 3,
    'a refusal consumes no budget — the counter did not move past the cap');
  perform pg_temp.ok(pg_temp.used(a, '__provider__') = 3,
    'and the refusal did not leave a dangling reservation on the emergency fuse');

  -- Classification is untouched by the exhausted invoice budget.
  perform pg_temp.ok((fn_ai_reserve_request(a, 'transaction-classification')->>'reserved')::boolean,
    'an exhausted invoice budget does NOT block transaction classification');
  perform fn_ai_release_request(a, 'transaction-classification');

  delete from ai_provider_company_budget_overrides where company_id = a;
  delete from ai_provider_daily_usage where company_id = a;
end $$;

-- ---------------------------------------------------------------------
-- 4. The emergency fuse binds even when the scope budget has room
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  r jsonb;
  i integer;
begin
  insert into ai_provider_company_budget_overrides (company_id, scope, daily_request_cap) values
    (a, '__provider__', 2),
    (a, 'supplier-invoice-extraction', 50);

  for i in 1..2 loop
    perform pg_temp.ok((fn_ai_reserve_request(a, 'supplier-invoice-extraction')->>'reserved')::boolean,
      format('request %s is within both layers', i));
  end loop;

  r := fn_ai_reserve_request(a, 'supplier-invoice-extraction');
  perform pg_temp.ok(not (r->>'reserved')::boolean, 'the emergency fuse refuses even though the scope budget has room');
  perform pg_temp.ok(r->>'refused_layer' = 'provider', 'and it says so');
  perform pg_temp.ok(pg_temp.used(a, 'supplier-invoice-extraction') = 2,
    'the scope reservation taken before the fuse refused was given back — the two counters never drift');
  perform pg_temp.ok(pg_temp.used(a, '__provider__') = 2, 'the fuse counter is at its cap, not past it');

  delete from ai_provider_company_budget_overrides where company_id = a;
  delete from ai_provider_daily_usage where company_id = a;
end $$;

-- ---------------------------------------------------------------------
-- 5. Guards
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  failed boolean := false;
begin
  begin
    perform fn_ai_reserve_request(a, '__provider__');
  exception when others then
    failed := true;
  end;
  perform pg_temp.ok(failed, 'the emergency fuse cannot be reserved against directly — it is not a feature scope');

  perform pg_temp.ok(fn_ai_resolve_daily_cap(a, 'no-such-scope') = 0
    and not (fn_ai_reserve_request(a, 'no-such-scope')->>'reserved')::boolean,
    'an unbudgeted scope can never make a provider request');

  -- A caller may lower its own cap but never raise it.
  insert into ai_provider_company_budget_overrides (company_id, scope, daily_request_cap) values (a, 'supplier-invoice-extraction', 1);
  perform pg_temp.ok((fn_ai_reserve_request(a, 'supplier-invoice-extraction', now(), 999)->>'reserved')::boolean,
    'an override asking for MORE than the budget is clamped to the budget');
  perform pg_temp.ok(not (fn_ai_reserve_request(a, 'supplier-invoice-extraction', now(), 999)->>'reserved')::boolean,
    'and the budget still binds at 1 — a caller cannot raise its own allowance');
  delete from ai_provider_company_budget_overrides where company_id = a;
  delete from ai_provider_daily_usage where company_id = a;
end $$;

-- ---------------------------------------------------------------------
-- 6. Tenant isolation and grants
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.co_a();
  b uuid := pg_temp.co_b();
begin
  perform fn_ai_reserve_request(a, 'supplier-invoice-extraction');
  perform pg_temp.ok(pg_temp.used(b, 'supplier-invoice-extraction') = 0,
    'one company''s usage is invisible to another''s counter');
  delete from ai_provider_daily_usage where company_id in (a, b);
end $$;

do $$
declare
  t text;
  leaked text := '';
begin
  foreach t in array array['ai_provider_scope_budgets', 'ai_provider_company_budget_overrides'] loop
    if exists (
      select 1 from information_schema.role_table_grants
      where table_name = t and grantee in ('anon', 'authenticated', 'public', 'service_role')
    ) then
      leaked := leaked || t || ' ';
    end if;
  end loop;
  perform pg_temp.ok(leaked = '',
    format('no API role can read or write the budget tables (leaked: "%s")', leaked));
end $$;

do $$
begin
  perform pg_temp.ok(
    (select count(*) from pg_policies where tablename = 'ai_provider_scope_budgets') = 0
    and (select relrowsecurity from pg_class where relname = 'ai_provider_scope_budgets'),
    'budget tables have RLS enabled and no policies — reachable only through security-definer functions');
end $$;

-- ---------------------------------------------------------------------
-- 7. MIGRATION-TIME REGRESSION — the 0099 -> 0107 upgrade on NON-EMPTY data.
--
--    Everything above exercises the runtime functions against the schema
--    this migration LEAVES BEHIND. That is not the same as testing the
--    upgrade itself, and the difference mattered: the emergency-fuse
--    backfill originally ran while the primary key was still
--    (company_id, usage_day), so every derived '__provider__' row carried
--    the same key as the row it was summed from, conflicted with its own
--    source, and was discarded by "on conflict do nothing". No error, no
--    data loss, and a fuse that silently started at zero on a database
--    that had already made requests.
--
--    A probe schema is used rather than the live table because the live
--    table can no longer provide the starting condition: once migrated it
--    has three key columns and a scope column. This rebuilds the real 0099
--    shape, puts non-empty data in it, and runs the migration's own
--    statements against it.
-- ---------------------------------------------------------------------
create schema _upgrade_probe;

-- An open, payment-required classification circuit — the production
-- condition at the time this migration is to be applied. Asserted
-- byte-for-byte unchanged after the upgrade runs.
update ai_provider_circuit_state
set state = 'open', open_reason = 'payment-required', opened_at = now(),
    next_probe_at = now() + interval '1 hour', last_http_status = 402,
    last_error_category = 'payment-required'
where scope = 'transaction-classification';

create temporary table _circuit_before on commit drop as
  select * from ai_provider_circuit_state;

set local search_path = _upgrade_probe, public;

-- Verbatim 0099 definition of the counter: two-column key, no scope column.
create table ai_provider_daily_usage (
  company_id uuid not null references public.companies (id) on delete cascade,
  usage_day date not null,
  reserved_requests integer not null default 0 check (reserved_requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, usage_day)
);

insert into _upgrade_probe.ai_provider_daily_usage (company_id, usage_day, reserved_requests)
values (pg_temp.co_a(), date '2026-09-15', 1),           -- A: one classification row
       (pg_temp.co_a(), date '2026-09-16', 2147483647),  -- D + L: another day, int4 max
       (pg_temp.co_b(), date '2026-09-15', 0);           -- C + E: another company, zero

create temporary table _usage_before on commit drop as
  select coalesce(sum(reserved_requests), 0) as total, count(*) as row_count
  from _upgrade_probe.ai_provider_daily_usage;

-- ---- THE UPGRADE, exactly as 0107 performs it -----------------------
alter table ai_provider_daily_usage
  add column if not exists scope text not null default 'transaction-classification';

do $upgrade$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_daily_usage_pkey'
      and conrelid = 'ai_provider_daily_usage'::regclass
      and array_length(conkey, 1) = 2
  ) then
    alter table ai_provider_daily_usage drop constraint ai_provider_daily_usage_pkey;
    alter table ai_provider_daily_usage add primary key (company_id, scope, usage_day);
  end if;
end;
$upgrade$;

insert into ai_provider_daily_usage (company_id, usage_day, scope, reserved_requests)
select company_id, usage_day, '__provider__', sum(reserved_requests)
from ai_provider_daily_usage
where scope <> '__provider__'
group by company_id, usage_day
on conflict do nothing;
-- ---- end of upgrade --------------------------------------------------

do $probe$
declare
  v_fuse bigint;
begin
  -- K. the key is exactly the three-column one
  perform pg_temp.ok(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = '_upgrade_probe.ai_provider_daily_usage'::regclass and contype = 'p')
    = 'PRIMARY KEY (company_id, scope, usage_day)',
    'K: the widened key is exactly (company_id, scope, usage_day)');

  -- H. no existing usage was changed by the upgrade
  perform pg_temp.ok(
    (select coalesce(sum(reserved_requests), 0) from _upgrade_probe.ai_provider_daily_usage
      where scope <> '__provider__') = (select total from _usage_before)
    and (select count(*) from _upgrade_probe.ai_provider_daily_usage where scope <> '__provider__')
        = (select row_count from _usage_before),
    'H: every pre-migration row survives untouched — same count, same total');

  -- A. the single classification row gets a fuse row of the same size
  select reserved_requests into v_fuse from _upgrade_probe.ai_provider_daily_usage
   where company_id = pg_temp.co_a() and usage_day = date '2026-09-15' and scope = '__provider__';
  perform pg_temp.ok(v_fuse = 1,
    'A: one existing classification row produces a fuse row with the same count — NOT zero');

  -- L. an int4-max counter is carried across exactly
  select reserved_requests into v_fuse from _upgrade_probe.ai_provider_daily_usage
   where company_id = pg_temp.co_a() and usage_day = date '2026-09-16' and scope = '__provider__';
  perform pg_temp.ok(v_fuse = 2147483647,
    'L: a very large reserved_requests is carried into the fuse exactly, not truncated');

  -- C + E. the second company gets its own fuse row, and zero is still a row
  perform pg_temp.ok(
    exists (select 1 from _upgrade_probe.ai_provider_daily_usage
      where company_id = pg_temp.co_b() and usage_day = date '2026-09-15'
        and scope = '__provider__' and reserved_requests = 0),
    'C+E: each company gets its OWN fuse row, and a zero-usage day still gets one');

  -- D. one fuse row per company/day, never a cross-day or cross-tenant merge
  perform pg_temp.ok(
    (select count(*) from _upgrade_probe.ai_provider_daily_usage where scope = '__provider__') = 3,
    'D: exactly one fuse row per (company, day) — three in, three out');
end;
$probe$;

-- B. several scopes on one company/day aggregate into a single fuse row.
--    Only reachable after the key widens, which is precisely why the
--    original ordering could never have produced it.
do $probe_b$
declare v_fuse bigint;
begin
  insert into _upgrade_probe.ai_provider_daily_usage (company_id, usage_day, scope, reserved_requests)
  values (pg_temp.co_b(), date '2026-09-16', 'transaction-classification', 4),
         (pg_temp.co_b(), date '2026-09-16', 'supplier-invoice-extraction', 6);

  insert into ai_provider_daily_usage (company_id, usage_day, scope, reserved_requests)
  select company_id, usage_day, '__provider__', sum(reserved_requests)
  from ai_provider_daily_usage
  where scope <> '__provider__'
  group by company_id, usage_day
  on conflict do nothing;

  select reserved_requests into v_fuse from _upgrade_probe.ai_provider_daily_usage
   where company_id = pg_temp.co_b() and usage_day = date '2026-09-16' and scope = '__provider__';
  perform pg_temp.ok(v_fuse = 10,
    'B: the fuse for a company/day is the SUM of every non-provider scope (4 + 6 = 10)');
end;
$probe_b$;

-- F + G. an existing fuse row stays authoritative, and re-running the whole
--        upgrade changes nothing.
do $probe_fg$
declare
  v_before text;
  v_after  text;
begin
  update _upgrade_probe.ai_provider_daily_usage set reserved_requests = 99
   where company_id = pg_temp.co_a() and usage_day = date '2026-09-15' and scope = '__provider__';

  select string_agg(company_id::text || usage_day::text || scope || reserved_requests::text, ',')
    into v_before from _upgrade_probe.ai_provider_daily_usage;

  -- the entire upgrade again, verbatim
  alter table ai_provider_daily_usage
    add column if not exists scope text not null default 'transaction-classification';
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_provider_daily_usage_pkey'
      and conrelid = 'ai_provider_daily_usage'::regclass
      and array_length(conkey, 1) = 2
  ) then
    alter table ai_provider_daily_usage drop constraint ai_provider_daily_usage_pkey;
    alter table ai_provider_daily_usage add primary key (company_id, scope, usage_day);
  end if;
  insert into ai_provider_daily_usage (company_id, usage_day, scope, reserved_requests)
  select company_id, usage_day, '__provider__', sum(reserved_requests)
  from ai_provider_daily_usage
  where scope <> '__provider__'
  group by company_id, usage_day
  on conflict do nothing;

  select string_agg(company_id::text || usage_day::text || scope || reserved_requests::text, ',')
    into v_after from _upgrade_probe.ai_provider_daily_usage;

  perform pg_temp.ok(v_after = v_before,
    'F+G: re-running the upgrade is inert — an existing fuse row is kept as-is, never doubled');
end;
$probe_fg$;

set local search_path = public;

-- I + J. the migration does not disturb circuit state. The only circuit
--        write 0107 performs is the new scope's row, "on conflict do
--        nothing"; an open, payment-required classification breaker must
--        come through byte-for-byte.
insert into ai_provider_circuit_state (scope) values ('supplier-invoice-extraction')
on conflict (scope) do nothing;

do $probe_ij$
begin
  perform pg_temp.ok(
    not exists (
      select * from ai_provider_circuit_state where scope = 'transaction-classification'
      except select * from _circuit_before where scope = 'transaction-classification'
    ) and not exists (
      select * from _circuit_before where scope = 'transaction-classification'
      except select * from ai_provider_circuit_state where scope = 'transaction-classification'
    ),
    'I: an OPEN payment-required classification circuit is byte-for-byte unchanged by the upgrade');

  perform pg_temp.ok(
    (select state from ai_provider_circuit_state where scope = 'supplier-invoice-extraction') = 'closed',
    'J: the new supplier-invoice-extraction breaker is initialised closed, and a re-insert cannot reopen it');

  perform pg_temp.ok(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ai_provider_daily_usage') = 1,
    'the probe never touched the live public.ai_provider_daily_usage');
end;
$probe_ij$;

drop schema _upgrade_probe cascade;


rollback;
\echo 'ai_scope_budgets: all checks passed (transaction rolled back)'
