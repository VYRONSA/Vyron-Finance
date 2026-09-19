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

rollback;
\echo 'ai_scope_budgets: all checks passed (transaction rolled back)'
